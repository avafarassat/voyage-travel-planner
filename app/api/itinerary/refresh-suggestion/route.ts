import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAlternativeSuggestion } from "@/lib/itinerary/google-places";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import type { PlaceCategory } from "@/lib/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { stopId, lat, lng, city, category, excludeGoogleIds = [] } = body as {
    stopId: string;
    lat: number;
    lng: number;
    city: string;
    category: PlaceCategory;
    excludeGoogleIds?: string[];
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { data: stop } = await supabase
    .from("itinerary_stops")
    .select("*, itinerary_days!inner(trip_id, trips!inner(user_id, city))")
    .eq("id", stopId)
    .single();

  if (!stop) {
    return NextResponse.json({ error: "Stop not found" }, { status: 404 });
  }

  const day = stop.itinerary_days as { trip_id: string; trips: { user_id: string; city: string } };
  if (day.trips.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tripId = day.trip_id;
  const tripCityName = day.trips.city;

  const [{ data: tripPlaces }, { data: tripStops }] = await Promise.all([
    supabase.from("places").select("google_place_id").eq("trip_id", tripId),
    supabase
      .from("itinerary_stops")
      .select("is_completed, place:places(google_place_id), itinerary_days!inner(trip_id)")
      .eq("itinerary_days.trip_id", tripId),
  ]);

  const serverExclude = getSuggestionExcludeGoogleIds(
    (tripPlaces ?? []) as { google_place_id: string | null }[],
    (tripStops ?? []).map((row) => ({
      is_completed: row.is_completed,
      place: Array.isArray(row.place) ? row.place[0] : row.place,
    })),
    excludeGoogleIds
  );

  const alternative = await fetchAlternativeSuggestion(
    lat,
    lng,
    tripCityName || city,
    category,
    serverExclude,
    apiKey
  );

  if (!alternative) {
    return NextResponse.json({ error: "No alternative found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("places")
    .select("id")
    .eq("trip_id", tripId)
    .eq("google_place_id", alternative.placeId)
    .maybeSingle();

  let placeId = existing?.id;

  if (!placeId) {
    const { data: newPlace } = await supabase
      .from("places")
      .insert({
        trip_id: tripId,
        name: alternative.name,
        category: alternative.category ?? category,
        address: alternative.address,
        lat: alternative.lat,
        lng: alternative.lng,
        source: "suggested",
        google_place_id: alternative.placeId,
        rating: alternative.rating ?? null,
        photo_url: alternative.photoUrl ?? null,
        opening_hours: alternative.openingHours ?? null,
      })
      .select()
      .single();
    placeId = newPlace?.id;
  }

  if (!placeId) {
    return NextResponse.json({ error: "Failed to save place" }, { status: 500 });
  }

  await supabase
    .from("itinerary_stops")
    .update({
      place_id: placeId,
      is_suggested: true,
    })
    .eq("id", stopId);

  return NextResponse.json({ success: true, placeId });
}
