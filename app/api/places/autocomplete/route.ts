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
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
}

const DESTINATION_PREFERRED_TYPES = new Set([
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "natural_feature",
  "colloquial_area",
  "political",
  "country",
  "postal_town",
  "sublocality",
]);

const ESTABLISHMENT_TYPES = new Set([
  "restaurant",
  "lodging",
  "store",
  "shopping_mall",
  "food",
  "cafe",
  "bar",
]);

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

function filterDestinationResults<
  T extends { types?: string[] }
>(results: T[]): T[] {
  const preferred = results.filter((place) =>
    place.types?.some((t) => DESTINATION_PREFERRED_TYPES.has(t))
  );
  if (preferred.length > 0) return preferred;

  const nonEstablishment = results.filter(
    (place) => !place.types?.some((t) => ESTABLISHMENT_TYPES.has(t))
  );
  return nonEstablishment.length > 0 ? nonEstablishment : results;
}

type RawPlaceResult = {
  place_id: string;
  name: string;
  types?: string[];
  formatted_address?: string;
  vicinity?: string;
  geometry: { location: { lat: number; lng: number } };
  photos?: { photo_reference: string }[];
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
};

function mapResults(
  data: { results?: RawPlaceResult[] },
  apiKey: string,
  limit: number,
  options?: { includePhotos?: boolean }
): AutocompleteResult[] {
  const includePhotos = options?.includePhotos ?? true;

  return (data.results ?? []).slice(0, limit).map((place) => ({
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address ?? place.vicinity ?? "",
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    category: googleTypeToCategory(place.types ?? []),
    photoUrl:
      includePhotos && place.photos?.[0]
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
        : undefined,
    rating: place.rating,
    userRatingsTotal: place.user_ratings_total,
    priceLevel: place.price_level,
  }));
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query");
  const city = request.nextUrl.searchParams.get("city");
  const country = request.nextUrl.searchParams.get("country");
  const type = request.nextUrl.searchParams.get("type") ?? "lodging";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(20, Math.max(1, Number(limitParam) || 8)) : 8;

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

  if (type === "destination" && data.results?.length) {
    data = {
      ...data,
      results: filterDestinationResults(data.results),
    };
  }

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    const hint = `${data.status ?? ""} ${data.error_message ?? ""}`.toLowerCase();
    const unavailable =
      data.status === "OVER_QUERY_LIMIT" ||
      data.status === "REQUEST_DENIED" ||
      hint.includes("quota") ||
      hint.includes("exceeded");

    return NextResponse.json(
      {
        error: unavailable
          ? "Search is temporarily unavailable."
          : "Search failed. Try again later.",
        code: unavailable ? "service_unavailable" : "search_failed",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    results: mapResults(data, apiKey, limit, {
      includePhotos: type !== "destination",
    }),
  });
}
