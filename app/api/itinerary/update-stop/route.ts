import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import {
  rescheduleFollowingOnDay,
  rescheduleItineraryDay,
} from "@/lib/itinerary/apply-reschedule";

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
    stopId,
    scheduledTime,
    durationMinutes,
    shiftFollowing = true,
  } = body as {
    stopId: string;
    scheduledTime?: string;
    durationMinutes?: number;
    shiftFollowing?: boolean;
  };

  if (!stopId) {
    return NextResponse.json({ error: "stopId required" }, { status: 400 });
  }

  if (!scheduledTime && durationMinutes === undefined) {
    return NextResponse.json(
      { error: "scheduledTime or durationMinutes required" },
      { status: 400 }
    );
  }

  const { data: stop } = await supabase
    .from("itinerary_stops")
    .select(
      "*, itinerary_days!inner(id, date, trip_id, trips!inner(user_id)), place:places(lat, lng)"
    )
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

  const place = Array.isArray(stop.place) ? stop.place[0] : stop.place;

  const patch: { scheduled_time?: string; duration_minutes?: number } = {};
  if (scheduledTime) {
    patch.scheduled_time = scheduledTime.includes(":")
      ? scheduledTime.length === 5
        ? `${scheduledTime}:00`
        : scheduledTime
      : scheduledTime;
  }
  if (durationMinutes !== undefined) {
    patch.duration_minutes = Math.max(15, Math.min(480, durationMinutes));
  }

  await supabase.from("itinerary_stops").update(patch).eq("id", stopId);

  if (shiftFollowing) {
    const updatedTime = patch.scheduled_time ?? stop.scheduled_time;
    const updatedDuration =
      patch.duration_minutes ?? stop.duration_minutes ?? 60;

    if (updatedTime && place && stop.stop_type !== "rest") {
      const departure = parseTimeToMinutes(updatedTime) + updatedDuration;
      await rescheduleFollowingOnDay(
        supabase,
        day.id,
        stopId,
        departure,
        { lat: place.lat, lng: place.lng }
      );
    } else {
      await rescheduleItineraryDay(supabase, day.id, day.date);
    }
  }

  return NextResponse.json({
    success: true,
    scheduledTime: patch.scheduled_time ?? stop.scheduled_time,
    durationMinutes: patch.duration_minutes ?? stop.duration_minutes,
  });
}
