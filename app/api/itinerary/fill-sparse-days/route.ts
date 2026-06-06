import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillSparseDaysForTrip } from "@/lib/itinerary/fill-sparse";
import { rescheduleAllItineraryDaysForTrip } from "@/lib/itinerary/apply-reschedule";
import { enrichPlacesOpeningHours } from "@/lib/itinerary/enrich-places";
import { ensureTripMeals } from "@/lib/itinerary/ensure-meals";
import type { Place } from "@/lib/types";

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
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const filledDays = await fillSparseDaysForTrip(supabase, tripId, apiKey);

  const { data: allPlaces } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  await enrichPlacesOpeningHours(supabase, (allPlaces ?? []) as Place[], apiKey);
  await ensureTripMeals(supabase, tripId, apiKey);
  const { data: placesAfterMeals } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  await enrichPlacesOpeningHours(supabase, (placesAfterMeals ?? []) as Place[], apiKey);
  await rescheduleAllItineraryDaysForTrip(supabase, tripId);
  return NextResponse.json({ filledDays, rescheduled: true });
}
