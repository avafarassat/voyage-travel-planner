import type { PlaceCategory, PlaceSearchResult } from "@/lib/types";
import { googleTypeToCategory } from "@/lib/types";

const CATEGORY_TO_GOOGLE_TYPE: Record<PlaceCategory, string> = {
  restaurant: "restaurant",
  bar: "bar",
  nightlife: "night_club",
  activity: "tourist_attraction",
  monument: "tourist_attraction",
  museum: "museum",
};

export { googleTypeToCategory };

export function getGooglePlaceType(category: PlaceCategory): string {
  return CATEGORY_TO_GOOGLE_TYPE[category];
}

export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.[0]) return null;

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}

export async function searchPlaces(
  query: string,
  location: { lat: number; lng: number },
  category: PlaceCategory,
  apiKey: string
): Promise<PlaceSearchResult[]> {
  const url = new URL("https://places.googleapis.com/v1/places:searchText");
  const body = {
    textQuery: query,
    locationBias: {
      circle: {
        center: { latitude: location.lat, longitude: location.lng },
        radius: 5000,
      },
    },
    includedType: getGooglePlaceType(category),
    maxResultCount: 10,
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.photos,places.types",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const places = data.places ?? [];

  return places.map(
    (p: {
      id: string;
      displayName?: { text: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      rating?: number;
      photos?: { name: string }[];
      types?: string[];
    }): PlaceSearchResult => ({
      placeId: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress ?? "",
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
      rating: p.rating,
      photoUrl: p.photos?.[0]?.name
        ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxHeightPx=200&key=${apiKey}`
        : undefined,
      types: p.types ?? [],
    })
  );
}

export async function getDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: "walking" | "transit" | "driving",
  apiKey: string
): Promise<{
  durationText: string;
  durationSeconds: number;
  distanceText: string;
} | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set(
    "origin",
    `${origin.lat},${origin.lng}`
  );
  url.searchParams.set(
    "destination",
    `${destination.lat},${destination.lng}`
  );
  url.searchParams.set("mode", mode);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) return null;

  const leg = data.routes[0].legs[0];
  return {
    durationText: leg.duration.text,
    durationSeconds: leg.duration.value,
    distanceText: leg.distance.text,
  };
}
