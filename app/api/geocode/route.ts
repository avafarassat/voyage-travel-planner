import { NextRequest, NextResponse } from "next/server";

async function geocodeAddress(address: string, apiKey: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.[0]) {
    return null;
  }

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "Address required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your-google-maps-api-key") {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const result = await geocodeAddress(address, apiKey);
  if (!result) {
    return NextResponse.json({ error: "Could not geocode address" }, { status: 404 });
  }

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { address, name, city, country } = body as {
    address?: string;
    name?: string;
    city?: string;
    country?: string;
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your-google-maps-api-key") {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const attempts = [
    address,
    name && city ? `${name}, ${city}${country ? `, ${country}` : ""}` : null,
    address && city ? `${address}, ${city}` : null,
    name,
  ].filter(Boolean) as string[];

  if (attempts.length === 0) {
    return NextResponse.json({ error: "Address or name required" }, { status: 400 });
  }

  for (const attempt of attempts) {
    const result = await geocodeAddress(attempt, apiKey);
    if (result) {
      return NextResponse.json(result);
    }
  }

  return NextResponse.json({ error: "Could not geocode address" }, { status: 404 });
}
