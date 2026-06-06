import { NextRequest, NextResponse } from "next/server";
import { googleTypeToCategory, type PlaceCategory } from "@/lib/types";

export interface AutocompleteResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: PlaceCategory;
  photoUrl?: string;
}

async function searchPlaces(
  searchQuery: string,
  apiKey: string,
  type?: string
) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", searchQuery);
  url.searchParams.set("key", apiKey);
  if (type === "lodging") {
    url.searchParams.set("type", "lodging");
  }

  const res = await fetch(url.toString());
  return res.json();
}

function mapResults(
  data: {
    results?: {
      place_id: string;
      name: string;
      types?: string[];
      formatted_address?: string;
      vicinity?: string;
      geometry: { location: { lat: number; lng: number } };
      photos?: { photo_reference: string }[];
    }[];
  },
  apiKey: string
): AutocompleteResult[] {
  return (data.results ?? []).slice(0, 8).map((place) => ({
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address ?? place.vicinity ?? "",
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    category: googleTypeToCategory(place.types ?? []),
    photoUrl: place.photos?.[0]
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
      : undefined,
  }));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query");
  const city = request.nextUrl.searchParams.get("city");
  const country = request.nextUrl.searchParams.get("country");
  const type = request.nextUrl.searchParams.get("type") ?? "lodging";

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your-google-maps-api-key") {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const locationHint = [city, country].filter(Boolean).join(", ");
  const searchQuery = locationHint ? `${query} ${locationHint}` : query;

  let data = await searchPlaces(searchQuery, apiKey, type);

  // Retry without lodging filter if no results
  if (
    (data.status === "ZERO_RESULTS" || !(data.results?.length ?? 0)) &&
    type === "lodging"
  ) {
    data = await searchPlaces(searchQuery, apiKey);
  }

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return NextResponse.json(
      { error: data.error_message ?? data.status ?? "Search failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ results: mapResults(data, apiKey) });
}
