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

  const { dayId } = (await request.json()) as { dayId: string };
  if (!dayId) {
    return NextResponse.json({ error: "dayId required" }, { status: 400 });
  }

  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, date, trip_id, trips!inner(user_id)")
    .eq("id", dayId)
    .single();

  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const trip = day.trips as unknown as { user_id: string };
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await rescheduleItineraryDay(supabase, dayId, day.date);
  return NextResponse.json({ success: true });
}
