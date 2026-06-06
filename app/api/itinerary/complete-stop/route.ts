import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { stopId, isCompleted } = (await request.json()) as {
    stopId: string;
    isCompleted: boolean;
  };

  if (!stopId || typeof isCompleted !== "boolean") {
    return NextResponse.json({ error: "stopId and isCompleted required" }, { status: 400 });
  }

  const { data: stop } = await supabase
    .from("itinerary_stops")
    .select("id, itinerary_days!inner(trip_id, trips!inner(user_id))")
    .eq("id", stopId)
    .single();

  if (!stop) {
    return NextResponse.json({ error: "Stop not found" }, { status: 404 });
  }

  const day = stop.itinerary_days as unknown as {
    trips: { user_id: string };
  };
  if (day.trips.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("itinerary_stops")
    .update({ is_completed: isCompleted })
    .eq("id", stopId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, isCompleted });
}
