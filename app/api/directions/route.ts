import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.searchParams.get("origin");
  const destination = request.nextUrl.searchParams.get("destination");
  const mode = request.nextUrl.searchParams.get("mode") ?? "walking";

  if (!origin || !destination) {
    return NextResponse.json({ error: "origin and destination required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const travelMode = mode === "transit" ? "transit" : mode === "driving" ? "driving" : "walking";

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("mode", travelMode);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) {
    return NextResponse.json({ error: "No route found" }, { status: 404 });
  }

  const leg = data.routes[0].legs[0];
  return NextResponse.json({
    durationText: leg.duration.text,
    durationSeconds: leg.duration.value,
    distanceText: leg.distance.text,
    mode: travelMode.toUpperCase(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { origin, destination, mode = "walking" } = body as {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    mode?: string;
  };

  if (!origin || !destination) {
    return NextResponse.json({ error: "origin and destination required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const travelMode = mode === "transit" ? "transit" : mode === "driving" ? "driving" : "walking";
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("mode", travelMode);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) {
    return NextResponse.json({ error: "No route found" }, { status: 404 });
  }

  const leg = data.routes[0].legs[0];
  return NextResponse.json({
    durationText: leg.duration.text,
    durationSeconds: leg.duration.value,
    distanceText: leg.distance.text,
    mode: travelMode.toUpperCase(),
  });
}
