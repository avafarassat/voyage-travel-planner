import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const rateLimit = new Map<string, { count: number; reset: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.reset) {
    rateLimit.set(ip, { count: 1, reset: now + 60000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { flightId } = await request.json();

  const { data: flight } = await supabase
    .from("flights")
    .select("*")
    .eq("id", flightId)
    .single();

  if (!flight) {
    return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("user_id")
    .eq("id", flight.trip_id)
    .single();

  if (!trip || trip.user_id !== user.id) {
    return NextResponse.json({ error: "Flight not found" }, { status: 404 });
  }

  const apiKey = process.env.AVIATIONSTACK_API_KEY;

  if (!apiKey) {
    await supabase
      .from("flights")
      .update({
        status: "Manual — add AviationStack API key for live updates",
        status_updated_at: new Date().toISOString(),
      })
      .eq("id", flightId);

    return NextResponse.json({
      status: "Manual — add AviationStack API key for live updates",
      changed: false,
    });
  }

  const depDate = new Date(flight.departure_time).toISOString().split("T")[0];
  const url = new URL("http://api.aviationstack.com/v1/flights");
  url.searchParams.set("access_key", apiKey);
  url.searchParams.set("flight_iata", flight.flight_number);
  url.searchParams.set("flight_date", depDate);

  const res = await fetch(url.toString());
  const data = await res.json();
  const live = data.data?.[0];

  let status = "On schedule";
  let changed = false;

  if (live?.flight_status) {
    status = live.flight_status;
    if (live.departure?.estimated) {
      const estimated = new Date(live.departure.estimated).toISOString();
      if (estimated !== flight.departure_time) {
        changed = true;
        await supabase
          .from("flights")
          .update({
            departure_time: estimated,
            status,
            status_updated_at: new Date().toISOString(),
          })
          .eq("id", flightId);
      }
    }
  }

  if (!changed) {
    await supabase
      .from("flights")
      .update({
        status,
        status_updated_at: new Date().toISOString(),
      })
      .eq("id", flightId);
  }

  return NextResponse.json({ status, changed });
}
