import { NextRequest, NextResponse } from "next/server";
import { fetchCityCoverImage } from "@/lib/trips/cover-image";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city");
  const country = request.nextUrl.searchParams.get("country");

  if (!city) {
    return NextResponse.json({ error: "City is required" }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your-google-maps-api-key") {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const url = await fetchCityCoverImage(city, country, apiKey);
  if (!url) {
    return NextResponse.json({ url: null });
  }

  return NextResponse.json({ url });
}
