import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePlacePhoto } from "@/lib/itinerary/google-places";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tripId } = (await request.json()) as { tripId: string };
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("id, city")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const { data: places } = await supabase
    .from("places")
    .select("id, name, lat, lng, google_place_id, photo_url")
    .eq("trip_id", tripId)
    .is("photo_url", null);

  let updated = 0;

  for (const place of places ?? []) {
    const resolved = await resolvePlacePhoto(place, trip.city, apiKey);
    if (!resolved?.photoUrl) continue;

    const patch: { photo_url: string; google_place_id?: string } = {
      photo_url: resolved.photoUrl,
    };
    if (!place.google_place_id && resolved.googlePlaceId) {
      patch.google_place_id = resolved.googlePlaceId;
    }

    const { error } = await supabase.from("places").update(patch).eq("id", place.id);
    if (!error) updated++;
  }

  return NextResponse.json({ updated });
}
