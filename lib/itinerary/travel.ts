import type { LatLng, Place, PlaceCategory } from "@/lib/types";
import { haversineDistance, estimateWalkMinutes } from "@/lib/itinerary/generate";
import { estimateScheduleTravelMinutes } from "@/lib/itinerary/schedule-times";

export type TravelTimeFn = (
  from: LatLng,
  to: LatLng
) => Promise<number>;

const cache = new Map<string, number>();

export function createEstimateTravelTimeFn(): TravelTimeFn {
  return async (from, to) => estimateScheduleTravelMinutes(from, to);
}

export function createTravelTimeFn(apiKey: string): TravelTimeFn {
  return async (from, to) => {
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}-${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    if (cache.has(key)) return cache.get(key)!;

    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", `${from.lat},${from.lng}`);
    url.searchParams.set("destination", `${to.lat},${to.lng}`);
    url.searchParams.set("mode", "walking");
    url.searchParams.set("key", apiKey);

    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.status === "OK" && data.routes?.[0]?.legs?.[0]) {
        const seconds = data.routes[0].legs[0].duration.value as number;
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        cache.set(key, minutes);
        return minutes;
      }
    } catch {
      // fall through
    }

    const fallback = estimateWalkMinutes(from, to);
    cache.set(key, fallback);
    return fallback;
  };
}

export function haversineKm(a: LatLng, b: LatLng): number {
  return haversineDistance(a, b);
}

/** Display-only speeds (km/h) — not used for scheduling. */
const DISPLAY_WALK_SPEED_KMH = 5;
const DISPLAY_DRIVE_SPEED_KMH = 30;
const DISPLAY_TRANSIT_SPEED_KMH = 20;
const DISPLAY_TRANSIT_WAIT_BUFFER_MIN = 7;

export interface EstimatedLegInfo {
  durationText: string;
  distanceText: string;
  isEstimated: true;
}

export interface EstimatedMultiLegTravel {
  walking: EstimatedLegInfo;
  driving: EstimatedLegInfo;
  transit: EstimatedLegInfo;
}

function formatDisplayMinutes(minutes: number): string {
  return `${Math.max(1, minutes)} min`;
}

function formatDisplayMiles(km: number): string {
  const miles = km * 0.621371;
  if (miles < 0.1) return "< 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}

/** Coordinate-based travel estimates for itinerary UI (no Google Directions). */
export function estimateDisplayTravelLegs(
  from: LatLng,
  to: LatLng
): EstimatedMultiLegTravel {
  const km = haversineDistance(from, to);
  const distanceText = formatDisplayMiles(km);

  const walkMinutes = Math.max(1, Math.round((km / DISPLAY_WALK_SPEED_KMH) * 60));
  const driveMinutes = Math.max(1, Math.round((km / DISPLAY_DRIVE_SPEED_KMH) * 60));
  const transitMinutes = Math.max(
    1,
    Math.round((km / DISPLAY_TRANSIT_SPEED_KMH) * 60) + DISPLAY_TRANSIT_WAIT_BUFFER_MIN
  );

  const leg = (minutes: number): EstimatedLegInfo => ({
    durationText: formatDisplayMinutes(minutes),
    distanceText,
    isEstimated: true,
  });

  return {
    walking: leg(walkMinutes),
    driving: leg(driveMinutes),
    transit: leg(transitMinutes),
  };
}

export function pickNearestOpenPlace(
  candidates: Place[],
  from: LatLng,
  dateStr: string,
  startMinutes: number,
  durationMinutes: number,
  usedIds: Set<string>
): Place | null {
  let best: Place | null = null;
  let bestDist = Infinity;

  for (const place of candidates) {
    if (usedIds.has(place.id)) continue;
    const dist = haversineDistance(from, { lat: place.lat, lng: place.lng });
    if (dist < bestDist) {
      bestDist = dist;
      best = place;
    }
  }

  return best;
}

export function sortByRating<T extends { rating?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

export function categoryMatchesInterest(
  category: PlaceCategory,
  interests: string[]
): boolean {
  if (interests.includes("restaurants") && category === "restaurant") return true;
  if (interests.includes("food_markets") && category === "restaurant") return true;
  if (interests.includes("bars_nightlife") && (category === "bar" || category === "nightlife"))
    return true;
  if (interests.includes("activities") && category === "activity") return true;
  if (interests.includes("monuments") && category === "monument") return true;
  if (interests.includes("museums") && category === "museum") return true;
  if (interests.includes("parks") && category === "activity") return true;
  if (interests.includes("shopping") && category === "activity") return true;
  return false;
}
