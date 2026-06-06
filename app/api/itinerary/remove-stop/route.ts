import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rescheduleItineraryDay } from "@/lib/itinerary/apply-reschedule";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { stopId } = (await request.json()) as { stopId: string };
  if (!stopId) {
    return NextResponse.json({ error: "stopId required" }, { status: 400 });
  }

  const { data: stop } = await supabase
    .from("itinerary_stops")
    .select("*, itinerary_days!inner(id, date, trip_id, trips!inner(user_id))")
    .eq("id", stopId)
    .single();

  if (!stop) {
    return NextResponse.json({ error: "Stop not found" }, { status: 404 });
  }

  const day = stop.itinerary_days as {
    id: string;
    date: string;
    trip_id: string;
    trips: { user_id: string };
  };
  if (day.trips.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dayId = day.id;

  const { data: remainingRaw } = await supabase
    .from("itinerary_stops")
    .select("id")
    .eq("itinerary_day_id", dayId)
    .neq("id", stopId)
    .order("sort_order");

  await supabase.from("itinerary_stops").delete().eq("id", stopId);

  const remaining = remainingRaw ?? [];
  await Promise.all(
    remaining.map((s, i) =>
      supabase.from("itinerary_stops").update({ sort_order: i }).eq("id", s.id)
    )
  );

  if (remaining.length > 0) {
    await rescheduleItineraryDay(supabase, dayId, day.date);
  }

  return NextResponse.json({ success: true });
}
