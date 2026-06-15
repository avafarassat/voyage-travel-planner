import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPlaceDetailProfile, resolvePlacePhoto } from "@/lib/itinerary/google-places";
import type { OpeningHours } from "@/lib/types";

function storedPlaceDetail(place: {
  name: string;
  address: string | null;
  category: string;
  photo_url: string | null;
  rating: number | null;
  opening_hours: OpeningHours | null;
}) {
  return {
    name: place.name,
    address: place.address,
    category: place.category,
    photoUrl: place.photo_url,
    rating: place.rating,
    reviews: [],
    photoUrls: [],
    openingHours: place.opening_hours ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const placeId = request.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  const { data: place } = await supabase
    .from("places")
    .select("*, trips!inner(user_id, city)")
    .eq("id", placeId)
    .single();

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const trip = place.trips as unknown as { user_id: string; city: string };
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (process.env.DISABLE_PLACE_PHOTO_PROXY === "true") {
    return NextResponse.json(storedPlaceDetail(place));
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  let googlePlaceId = place.google_place_id;
  if (!googlePlaceId) {
    const resolved = await resolvePlacePhoto(place, trip.city, apiKey);
    googlePlaceId = resolved?.googlePlaceId ?? null;
  }

  if (!googlePlaceId) {
    return NextResponse.json(storedPlaceDetail(place));
  }

  const profile = await fetchPlaceDetailProfile(googlePlaceId, apiKey);
  if (!profile) {
    return NextResponse.json(storedPlaceDetail(place));
  }

  return NextResponse.json({
    ...profile,
    category: place.category,
    photoUrl: profile.photoUrls[0] ?? place.photo_url,
    openingHours: profile.openingHours ?? place.opening_hours ?? undefined,
  });
}
