import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAlternativeSuggestion } from "@/lib/itinerary/google-places";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import type { PlaceCategory } from "@/lib/types";

async function getInsertLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dayId: string,
  tripId: string,
  insertAfterStopId: string | null | undefined
): Promise<{ lat: number; lng: number; city: string } | null> {
  const { data: trip } = await supabase
    .from("trips")
    .select("city")
    .eq("id", tripId)
    .single();

  if (!trip) return null;

  if (insertAfterStopId) {
    const { data: stop } = await supabase
      .from("itinerary_stops")
      .select("place:places(lat, lng)")
      .eq("id", insertAfterStopId)
      .single();

    const place = Array.isArray(stop?.place) ? stop?.place[0] : stop?.place;
    if (place?.lat != null && place?.lng != null) {
      return { lat: place.lat, lng: place.lng, city: trip.city };
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

async function getExcludeGoogleIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tripId: string,
  extra: string[] = []
): Promise<string[]> {
  const [{ data: places }, { data: stops }] = await Promise.all([
    supabase.from("places").select("google_place_id").eq("trip_id", tripId),
    supabase
      .from("itinerary_stops")
      .select("is_completed, place:places(google_place_id), itinerary_days!inner(trip_id)")
      .eq("itinerary_days.trip_id", tripId),
  ]);

  return getSuggestionExcludeGoogleIds(
    (places ?? []) as { google_place_id: string | null }[],
    (stops ?? []).map((row) => ({
      is_completed: row.is_completed,
      place: Array.isArray(row.place) ? row.place[0] : row.place,
    })),
    extra
  );
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
  const { dayId, category, insertAfterStopId, excludeGoogleIds = [] } = body as {
    dayId: string;
    category: PlaceCategory;
    insertAfterStopId?: string | null;
    excludeGoogleIds?: string[];
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, trip_id, trips!inner(user_id)")
    .eq("id", dayId)
    .single();

  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const tripOwner = (day.trips as unknown as { user_id: string }).user_id;
  if (tripOwner !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const location = await getInsertLocation(
    supabase,
    dayId,
    day.trip_id,
    insertAfterStopId
  );
  if (!location) {
    return NextResponse.json({ error: "Could not determine location" }, { status: 400 });
  }

  const excludeIds = await getExcludeGoogleIds(supabase, day.trip_id, excludeGoogleIds);
  const suggestion = await fetchAlternativeSuggestion(
    location.lat,
    location.lng,
    location.city,
    category,
    excludeIds,
    apiKey
  );

  if (!suggestion) {
    return NextResponse.json({ error: "No suggestion found nearby" }, { status: 404 });
  }

  return NextResponse.json({
    name: suggestion.name,
    address: suggestion.address,
    rating: suggestion.rating,
    category: suggestion.category ?? category,
    photoUrl: suggestion.photoUrl,
    googlePlaceId: suggestion.placeId,
  });
}
