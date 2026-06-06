import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAlternativeSuggestion, fetchPlaceByGoogleId } from "@/lib/itinerary/google-places";
import { getDefaultVisitMinutes } from "@/lib/itinerary/hours";
import {
  estimateTravelMinutes,
  rescheduleStopsFromOrder,
} from "@/lib/itinerary/reschedule-day";
import type { PlaceCategory } from "@/lib/types";

async function getInsertLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dayId: string,
  tripId: string,
  insertAfterStopId: string | null | undefined,
  existingStops: { id: string; place?: { lat: number; lng: number } | null }[]
): Promise<{ lat: number; lng: number; city: string } | null> {
  const { data: trip } = await supabase
    .from("trips")
    .select("city")
    .eq("id", tripId)
    .single();

  if (!trip) return null;

  if (insertAfterStopId) {
    const afterStop = existingStops.find((s) => s.id === insertAfterStopId);
    if (afterStop?.place) {
      return { lat: afterStop.place.lat, lng: afterStop.place.lng, city: trip.city };
    }
  }

  const { data: hotel } = await supabase
    .from("hotels")
    .select("lat, lng")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (!hotel) return null;
  return { lat: hotel.lat, lng: hotel.lng, city: trip.city };
}

async function resolvePlaceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  placeId: string | undefined,
  category: PlaceCategory | undefined,
  googlePlaceId: string | undefined,
  location: { lat: number; lng: number; city: string },
  apiKey: string,
  isSuggested: { value: boolean }
): Promise<{ id: string; category: PlaceCategory } | null> {
  if (placeId) {
    const { data: place } = await supabase
      .from("places")
      .select("id, category")
      .eq("id", placeId)
      .eq("trip_id", tripId)
      .single();
    if (!place) return null;
    isSuggested.value = false;
    return { id: place.id, category: place.category as PlaceCategory };
  }

  if (!category) return null;

  if (googlePlaceId) {
    const { data: existingByGoogle } = await supabase
      .from("places")
      .select("id, category")
      .eq("trip_id", tripId)
      .eq("google_place_id", googlePlaceId)
      .maybeSingle();

    if (existingByGoogle) {
      isSuggested.value = true;
      return { id: existingByGoogle.id, category: existingByGoogle.category as PlaceCategory };
    }
  }

  const { data: tripPlaces } = await supabase
    .from("places")
    .select("google_place_id")
    .eq("trip_id", tripId);

  const excludeIds = (tripPlaces ?? [])
    .map((p) => p.google_place_id)
    .filter(Boolean) as string[];

  const suggestion = googlePlaceId
    ? (await fetchPlaceByGoogleId(googlePlaceId, apiKey)) ??
      (await fetchAlternativeSuggestion(
        location.lat,
        location.lng,
        location.city,
        category,
        excludeIds,
        apiKey
      ))
    : await fetchAlternativeSuggestion(
        location.lat,
        location.lng,
        location.city,
        category,
        excludeIds,
        apiKey
      );

  if (!suggestion) return null;

  const { data: existing } = await supabase
    .from("places")
    .select("id, category")
    .eq("trip_id", tripId)
    .eq("google_place_id", suggestion.placeId)
    .maybeSingle();

  if (existing) {
    isSuggested.value = true;
    return { id: existing.id, category: existing.category as PlaceCategory };
  }

  const resolvedCategory = (suggestion.category ?? category) as PlaceCategory;
  const { data: newPlace } = await supabase
    .from("places")
    .insert({
      trip_id: tripId,
      name: suggestion.name,
      category: resolvedCategory,
      address: suggestion.address,
      lat: suggestion.lat,
      lng: suggestion.lng,
      source: "suggested",
      google_place_id: suggestion.placeId,
      rating: suggestion.rating ?? null,
      photo_url: suggestion.photoUrl ?? null,
      opening_hours: suggestion.openingHours ?? null,
    })
    .select("id, category")
    .single();

  if (!newPlace) return null;
  isSuggested.value = true;
  return { id: newPlace.id, category: newPlace.category as PlaceCategory };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { dayId, placeId, category, googlePlaceId, insertAfterStopId } = body as {
    dayId: string;
    placeId?: string;
    category?: PlaceCategory;
    googlePlaceId?: string;
    insertAfterStopId?: string | null;
  };

  if (!placeId && !category) {
    return NextResponse.json({ error: "placeId or category required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, trip_id, date, trips!inner(user_id, day_start_time)")
    .eq("id", dayId)
    .single();

  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const trip = day.trips as unknown as { user_id: string; day_start_time: string | null };
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existingStopsRaw } = await supabase
    .from("itinerary_stops")
    .select("*, place:places(lat, lng, category)")
    .eq("itinerary_day_id", dayId)
    .order("sort_order");

  const stops = (existingStopsRaw ?? []).map((s) => ({
    ...s,
    place: Array.isArray(s.place) ? s.place[0] : s.place,
  }));

  const location = await getInsertLocation(
    supabase,
    dayId,
    day.trip_id,
    insertAfterStopId,
    stops
  );
  if (!location) {
    return NextResponse.json({ error: "Could not determine location" }, { status: 400 });
  }

  const isSuggested = { value: false };
  const resolved = await resolvePlaceId(
    supabase,
    day.trip_id,
    placeId,
    category,
    googlePlaceId,
    location,
    apiKey,
    isSuggested
  );

  if (!resolved) {
    return NextResponse.json(
      { error: placeId ? "Place not found" : "No suggestion found nearby" },
      { status: placeId ? 404 : 404 }
    );
  }

  const { data: hotel } = await supabase
    .from("hotels")
    .select("lat, lng")
    .eq("trip_id", day.trip_id)
    .maybeSingle();

  let sortOrder = stops.length;

  if (insertAfterStopId) {
    const afterIdx = stops.findIndex((s) => s.id === insertAfterStopId);
    if (afterIdx >= 0) {
      sortOrder = afterIdx + 1;
      for (let i = afterIdx + 1; i < stops.length; i++) {
        await supabase
          .from("itinerary_stops")
          .update({ sort_order: i + 1 })
          .eq("id", stops[i].id);
      }
    }
  }

  const duration = getDefaultVisitMinutes(resolved.category);

  const { data: newStop, error } = await supabase
    .from("itinerary_stops")
    .insert({
      itinerary_day_id: dayId,
      place_id: resolved.id,
      sort_order: sortOrder,
      stop_type: "place",
      duration_minutes: duration,
      is_suggested: isSuggested.value,
    })
    .select("*, place:places(lat, lng, category)")
    .single();

  if (error || !newStop) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const newStopNormalized = {
    ...newStop,
    place: Array.isArray(newStop.place) ? newStop.place[0] : newStop.place,
  };

  const allStops = [
    ...stops.slice(0, sortOrder),
    newStopNormalized,
    ...stops.slice(sortOrder),
  ].map((s, i) => ({ ...s, sort_order: i }));

  if (hotel) {
    const dayStart = trip.day_start_time
      ? parseInt(trip.day_start_time.split(":")[0], 10) * 60 +
        parseInt(trip.day_start_time.split(":")[1] ?? "0", 10)
      : 8 * 60;

    const updates = rescheduleStopsFromOrder(
      allStops.map((s) => ({
        id: s.id,
        sort_order: s.sort_order,
        stop_type: s.stop_type,
        meal_type: s.meal_type,
        duration_minutes: s.duration_minutes,
        scheduled_time: s.scheduled_time,
        place: s.place as { lat: number; lng: number; category: PlaceCategory } | null,
        opening_hours: (s.place as { opening_hours?: unknown } | null)?.opening_hours ?? null,
      })),
      { lat: hotel.lat, lng: hotel.lng },
      dayStart,
      day.date,
      estimateTravelMinutes
    );

    for (const u of updates) {
      await supabase
        .from("itinerary_stops")
        .update({ scheduled_time: u.scheduled_time })
        .eq("id", u.id);
    }
  }

  return NextResponse.json({
    success: true,
    stopId: newStop.id,
    isSuggested: isSuggested.value,
    placeName: newStopNormalized.place?.name,
  });
}
