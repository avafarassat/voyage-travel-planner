import { NextRequest, NextResponse } from "next/server";

async function fetchLeg(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: "walking" | "driving" | "transit",
  apiKey: string
) {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
  url.searchParams.set("mode", mode);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) return null;
    const leg = data.routes[0].legs[0];
    return {
      durationText: leg.duration.text as string,
      durationSeconds: leg.duration.value as number,
      distanceText: leg.distance.text as string,
    };
  } catch {
    return null;
  }
}

async function fetchMultiLeg(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
) {
  const [walking, driving, transit] = await Promise.all([
    fetchLeg(origin, destination, "walking", apiKey),
    fetchLeg(origin, destination, "driving", apiKey),
    fetchLeg(origin, destination, "transit", apiKey),
  ]);
  return { walking, driving, transit };
}

/** Process items with limited concurrency. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { origin, destination, legs } = body as {
    origin?: { lat: number; lng: number };
    destination?: { lat: number; lng: number };
    legs?: { key: string; origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }[];
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  // Batch mode — one request for the whole itinerary
  if (legs?.length) {
    const capped = legs.slice(0, 80);
    const entries = await mapPool(capped, 4, async (leg) => {
      const data = await fetchMultiLeg(leg.origin, leg.destination, apiKey);
      return { key: leg.key, data };
    });

    const result: Record<string, Awaited<ReturnType<typeof fetchMultiLeg>>> = {};
    for (const { key, data } of entries) {
      result[key] = data;
    }
    return NextResponse.json({ directions: result });
  }

  // Single leg (legacy)
  if (!origin || !destination) {
    return NextResponse.json({ error: "origin and destination required" }, { status: 400 });
  }

  return NextResponse.json(await fetchMultiLeg(origin, destination, apiKey));
}
