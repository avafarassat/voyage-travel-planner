import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rescheduleItineraryDay } from "@/lib/itinerary/apply-reschedule";
import { parseDayBounds, parseTimeToMinutes, minutesToTimeString } from "@/lib/itinerary/reschedule-day";

function stopStartMinutes(stop: { scheduled_time: string | null }): number {
  return stop.scheduled_time
    ? parseTimeToMinutes(stop.scheduled_time)
    : 0;
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
  const {
    dayId,
    durationMinutes,
    title = "Rest at hotel",
    restForRemainder = false,
    startTime,
  } = body as {
    dayId: string;
    durationMinutes?: number;
    title?: string;
    restForRemainder?: boolean;
    startTime?: string;
  };

  if (!startTime || !/^\d{1,2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: "Start time required (HH:MM)" }, { status: 400 });
  }

  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, date, trip_id, trips!inner(user_id, day_start_time, day_end_time)")
    .eq("id", dayId)
    .single();

  if (!day) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }

  const trip = day.trips as unknown as {
    user_id: string;
    day_start_time: string | null;
    day_end_time: string | null;
  };
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dayStartMinutes, dayEndMinutes } = parseDayBounds(trip.day_start_time, trip.day_end_time);

  const startMinutes = parseTimeToMinutes(`${startTime}:00`);
  if (startMinutes < dayStartMinutes || startMinutes >= dayEndMinutes) {
    return NextResponse.json(
      { error: "Start time must be within your trip day hours" },
      { status: 400 }
    );
  }

  const { data: existingStops } = await supabase
    .from("itinerary_stops")
    .select("*")
    .eq("itinerary_day_id", dayId)
    .order("sort_order");

  const stops = existingStops ?? [];

  let finalDuration = durationMinutes ?? 60;
  let finalTitle = title;

  if (restForRemainder) {
    finalDuration = Math.max(dayEndMinutes - startMinutes, 30);
    finalTitle = "Rest — taking it easy";
  } else if (!finalDuration || finalDuration < 15) {
    return NextResponse.json({ error: "Invalid rest block" }, { status: 400 });
  }

  if (startMinutes + finalDuration > dayEndMinutes) {
    return NextResponse.json(
      { error: "Rest block extends past the end of your day" },
      { status: 400 }
    );
  }

  const stopsToRemove = restForRemainder
    ? stops.filter((stop) => stopStartMinutes(stop) >= startMinutes)
    : [];

  if (stopsToRemove.length) {
    await supabase
      .from("itinerary_stops")
      .delete()
      .in(
        "id",
        stopsToRemove.map((s) => s.id)
      );
  }

  const remaining = stops
    .filter((s) => !stopsToRemove.some((r) => r.id === s.id))
    .sort((a, b) => a.sort_order - b.sort_order);

  let insertSortOrder = remaining.findIndex(
    (s) => stopStartMinutes(s) >= startMinutes
  );
  if (insertSortOrder === -1) insertSortOrder = remaining.length;

  for (let i = insertSortOrder; i < remaining.length; i++) {
    await supabase
      .from("itinerary_stops")
      .update({ sort_order: i + 1 })
      .eq("id", remaining[i].id);
  }

  const scheduledTime = minutesToTimeString(startMinutes);

  const { data: restStop, error } = await supabase
    .from("itinerary_stops")
    .insert({
      itinerary_day_id: dayId,
      place_id: null,
      sort_order: insertSortOrder,
      stop_type: "rest",
      title: finalTitle,
      duration_minutes: finalDuration,
      scheduled_time: scheduledTime,
      is_suggested: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await rescheduleItineraryDay(supabase, dayId, day.date);

  return NextResponse.json({
    success: true,
    stop: restStop,
    fillSparseDays: restForRemainder,
    removedStops: stopsToRemove.length,
  });
}
