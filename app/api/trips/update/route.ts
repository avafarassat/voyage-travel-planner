import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  clearOutOfRangeReservations,
  syncItineraryDaysForTripDates,
} from "@/lib/trips/sync-itinerary-days";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    tripId: string;
    startDate?: string;
    endDate?: string;
    name?: string;
  };

  const { tripId, startDate, endDate, name } = body;
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  if (!startDate && !endDate && !name?.trim()) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const nextStart = startDate ?? trip.start_date;
  const nextEnd = endDate ?? trip.end_date;

  if (nextStart > nextEnd) {
    return NextResponse.json(
      { error: "Start date must be on or before end date" },
      { status: 400 }
    );
  }

  const patch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };
  if (startDate) patch.start_date = startDate;
  if (endDate) patch.end_date = endDate;
  if (name?.trim()) patch.name = name.trim();

  const { error: updateError } = await supabase
    .from("trips")
    .update(patch)
    .eq("id", tripId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const datesChanged =
    nextStart !== trip.start_date || nextEnd !== trip.end_date;

  let itinerarySync = { updated: 0, added: 0, removed: 0 };
  let clearedReservations = 0;

  if (datesChanged) {
    itinerarySync = await syncItineraryDaysForTripDates(
      supabase,
      tripId,
      nextStart,
      nextEnd
    );
    clearedReservations = await clearOutOfRangeReservations(
      supabase,
      tripId,
      nextStart,
      nextEnd
    );
  }

  return NextResponse.json({
    ok: true,
    startDate: nextStart,
    endDate: nextEnd,
    name: name?.trim() ?? trip.name,
    itinerarySync,
    clearedReservations,
  });
}
