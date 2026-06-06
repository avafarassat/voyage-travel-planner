import type { LatLng } from "@/lib/types";
import { haversineDistance } from "@/lib/itinerary/generate";
import { MEAL_WINDOWS, type MealType } from "@/lib/itinerary/hours";
import { presentMealSlots, type MealSlotStop } from "@/lib/itinerary/meal-slots";
import { parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";

/** Distance from hotel (km) that counts as a day-trip / excursion. */
export const EXCURSION_DISTANCE_KM = 12;

export function isExcursionPlace(hotel: LatLng, place: LatLng): boolean {
  return haversineDistance(hotel, place) >= EXCURSION_DISTANCE_KM;
}

export function splitByExcursionDistance<T extends LatLng>(
  hotel: LatLng,
  places: T[]
): { excursion: T[]; local: T[] } {
  const excursion: T[] = [];
  const local: T[] = [];
  for (const place of places) {
    if (isExcursionPlace(hotel, place)) excursion.push(place);
    else local.push(place);
  }
  return { excursion, local };
}

export function getActivityLocations(
  stops: {
    stopType?: string;
    stop_type?: string;
    mealType?: string;
    meal_type?: string | null;
    place?: { lat: number; lng: number } | null;
    suggestedPlace?: { lat: number; lng: number } | null;
  }[]
): LatLng[] {
  const locs: LatLng[] = [];
  for (const stop of stops) {
    const isMeal =
      stop.stopType === "meal" ||
      stop.stop_type === "meal" ||
      stop.mealType ||
      stop.meal_type;
    if (isMeal) continue;
    const loc = stop.place ?? stop.suggestedPlace;
    if (loc) locs.push({ lat: loc.lat, lng: loc.lng });
  }
  return locs;
}

export function isExcursionDay(hotel: LatLng, activityLocations: LatLng[]): boolean {
  if (activityLocations.length === 0) return false;
  return activityLocations.some(
    (loc) => haversineDistance(hotel, loc) >= EXCURSION_DISTANCE_KM
  );
}

/**
 * Where to search for a meal suggestion:
 * - Breakfast & dinner: near the hotel (start/end of day).
 * - Lunch: near day activities, or the excursion destination if it's a day trip.
 */
export function getMealSearchLocation(
  meal: MealType,
  hotel: LatLng,
  activityLocations: LatLng[]
): LatLng {
  if (meal === "breakfast" || meal === "dinner") {
    return hotel;
  }

  if (activityLocations.length === 0) {
    return hotel;
  }

  let farthest = activityLocations[0];
  let maxDist = haversineDistance(hotel, farthest);
  for (const loc of activityLocations) {
    const dist = haversineDistance(hotel, loc);
    if (dist > maxDist) {
      maxDist = dist;
      farthest = loc;
    }
  }

  if (maxDist >= EXCURSION_DISTANCE_KM) {
    return farthest;
  }

  const lat =
    activityLocations.reduce((sum, p) => sum + p.lat, 0) / activityLocations.length;
  const lng =
    activityLocations.reduce((sum, p) => sum + p.lng, 0) / activityLocations.length;
  return { lat, lng };
}

/** Long day trips need a longer block on the schedule. */
export function excursionVisitMinutes(
  hotel: LatLng,
  place: { lat: number; lng: number; category?: string },
  defaultMinutes: number
): number {
  const dist = haversineDistance(hotel, place);
  if (dist >= EXCURSION_DISTANCE_KM) {
    return Math.max(defaultMinutes, 360);
  }
  return defaultMinutes;
}

export function dayMissingMeals(
  stops: {
    mealType?: string | null;
    meal_type?: string | null;
    stopType?: string;
    stop_type?: string;
    scheduled_time?: string | null;
    scheduledTime?: string | null;
    duration_minutes?: number | null;
    place?: {
      category?: string;
      reservation_time?: string | null;
      lat?: number;
      lng?: number;
      source?: string;
    } | null;
  }[],
  reservedMeals?: Iterable<MealType>
): MealType[] {
  const slotStops: MealSlotStop[] = stops.map((s) => ({
    meal_type: s.mealType ?? s.meal_type,
    stop_type: s.stopType ?? s.stop_type,
    scheduled_time: s.scheduledTime ?? s.scheduled_time,
    duration_minutes: s.duration_minutes,
    place: s.place,
  }));

  const present = presentMealSlots(slotStops);
  for (const meal of reservedMeals ?? []) present.add(meal);
  return (Object.keys(MEAL_WINDOWS) as MealType[]).filter((m) => !present.has(m));
}

export function mealsEnabled(): boolean {
  return true;
}
