import type { LatLng } from "@/lib/types";
import {
  adjustStartForOpeningHours,
  getMealEarliestMinutes,
  inferMealTypeFromMinutes,
  MEAL_WINDOWS,
  type MealType,
  type OpeningHours,
} from "@/lib/itinerary/hours";
import { excursionVisitMinutes, isExcursionPlace } from "@/lib/itinerary/meal-locations";
import { parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";

const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner"];

/** Minimum gap between a meal ending and the next meal or activity. */
export const MEAL_ACTIVITY_GAP = 30;

/** Option B: late brunch target band after a morning reservation anchor. */
export const LATE_BRUNCH_EARLIEST = 10 * 60 + 15;
export const LATE_BRUNCH_LATEST = 10 * 60 + 45;

export type MealSlotStop = {
  id?: string;
  meal_type?: string | null;
  stop_type?: string;
  scheduled_time?: string | null;
  duration_minutes?: number | null;
  place?: {
    category?: string;
    reservation_time?: string | null;
    lat?: number;
    lng?: number;
    source?: string;
  } | null;
};

function mealDuration(meal: MealType): number {
  return MEAL_WINDOWS[meal].duration;
}

function stopDurationMinutes(stop: MealSlotStop): number {
  if (stop.duration_minutes != null) return stop.duration_minutes;
  if (stop.meal_type && stop.meal_type in MEAL_WINDOWS) {
    return MEAL_WINDOWS[stop.meal_type as MealType].duration;
  }
  return 75;
}

function stopStartMinutes(stop: MealSlotStop): number | null {
  const time =
    stop.place?.reservation_time ?? stop.scheduled_time ?? null;
  if (!time) return null;
  return parseTimeToMinutes(time.slice(0, 8));
}

function stopEndMinutes(stop: MealSlotStop): number | null {
  const start = stopStartMinutes(stop);
  if (start == null) return null;
  return start + stopDurationMinutes(stop);
}

function isSacredReservation(stop: MealSlotStop): boolean {
  return Boolean(stop.place?.reservation_time) || stop.place?.source === "manual";
}

function effectiveMealType(stop: MealSlotStop): MealType | null {
  if (stop.meal_type) return stop.meal_type as MealType;
  // Only explicit meal stops count — restaurant visits at meal times are not meals.
  if (stop.stop_type !== "meal") return null;
  const start = stopStartMinutes(stop);
  if (start == null) return null;
  return inferMealTypeFromMinutes(start);
}

function lunchEndBoundaryMinutes(lunchStart: number | null): number {
  return (lunchStart ?? MEAL_WINDOWS.lunch.start) - MEAL_ACTIVITY_GAP;
}

/** Lunch start used to cap breakfast/brunch when lunch can shift within its window. */
export function effectiveLunchStartForBreakfastBounds(
  stops: MealSlotStop[]
): number {
  const lunchStop = stops.find((s) => effectiveMealType(s) === "lunch");
  if (!lunchStop) return MEAL_WINDOWS.lunch.start;
  if (isSacredReservation(lunchStop)) return stopStartMinutes(lunchStop)!;
  return MEAL_WINDOWS.lunch.end;
}

export function minimumLunchStartAfterBreakfast(breakfastStartMinutes: number): number {
  return (
    breakfastStartMinutes + MEAL_WINDOWS.breakfast.duration + MEAL_ACTIVITY_GAP
  );
}

function morningAnchorEndMinutes(anchor: MealSlotStop, hotel: LatLng): number {
  const anchorStart = parseTimeToMinutes(anchor.place!.reservation_time!.slice(0, 8));
  const place = anchor.place!;
  let duration = stopDurationMinutes(anchor);
  if (place.lat != null && place.lng != null && isExcursionPlace(hotel, place as LatLng)) {
    duration = excursionVisitMinutes(
      hotel,
      { lat: place.lat, lng: place.lng, category: place.category },
      duration
    );
  }
  return anchorStart + duration;
}

function morningReservationAnchors(stops: MealSlotStop[]): MealSlotStop[] {
  return stops
    .filter((s) => {
      const t = s.place?.reservation_time;
      if (!t) return false;
      return parseTimeToMinutes(t.slice(0, 8)) < MEAL_WINDOWS.lunch.start;
    })
    .sort(
      (a, b) =>
        parseTimeToMinutes(a.place!.reservation_time!.slice(0, 8)) -
        parseTimeToMinutes(b.place!.reservation_time!.slice(0, 8))
    );
}

export function presentMealSlots(stops: MealSlotStop[]): Set<MealType> {
  const present = new Set<MealType>();
  for (const stop of stops) {
    const meal = effectiveMealType(stop);
    if (meal) present.add(meal);
  }
  return present;
}

export function missingMealSlots(stops: MealSlotStop[]): MealType[] {
  const present = presentMealSlots(stops);
  return MEAL_ORDER.filter((m) => !present.has(m));
}

function latestMealEnd(stops: MealSlotStop[], meal: MealType): number | null {
  let best: number | null = null;
  for (const stop of stops) {
    if (effectiveMealType(stop) !== meal) continue;
    const end = stopEndMinutes(stop);
    if (end != null) best = best == null ? end : Math.max(best, end);
  }
  return best;
}

export function earliestMealStart(stops: MealSlotStop[], meal: MealType): number | null {
  let best: number | null = null;
  for (const stop of stops) {
    if (effectiveMealType(stop) !== meal) continue;
    const start = stopStartMinutes(stop);
    if (start != null) best = best == null ? start : Math.min(best, start);
  }
  return best;
}

function breakfastBounds(
  stops: MealSlotStop[],
  date: string,
  hotel: LatLng,
  openingHours?: OpeningHours | null
): { notBefore: number; notAfter: number } | null {
  const window = MEAL_WINDOWS.breakfast;
  const lunchStartCap = effectiveLunchStartForBreakfastBounds(stops);
  const lunchEndBoundary = lunchEndBoundaryMinutes(lunchStartCap);
  const latestStart = lunchEndBoundary - window.duration;

  const mealEarliest = getMealEarliestMinutes("breakfast", date, openingHours);
  let notBefore = Math.max(window.start, mealEarliest);

  const morningAnchors = morningReservationAnchors(stops);
  const excursion = morningAnchors.find(
    (s) => s.place && isExcursionPlace(hotel, s.place as LatLng)
  );

  if (morningAnchors.length > 0 && !excursion) {
    const first = morningAnchors[0];
    if (first.place?.reservation_time) {
      const anchorStart = parseTimeToMinutes(
        first.place.reservation_time.slice(0, 8)
      );
      const preAnchorNotAfter = anchorStart - MEAL_ACTIVITY_GAP - window.duration;
      if (preAnchorNotAfter >= notBefore) {
        return { notBefore, notAfter: preAnchorNotAfter };
      }
    }
  }

  for (const anchor of morningAnchors) {
    const anchorEnd = morningAnchorEndMinutes(anchor, hotel);
    const isLocalExcursion =
      anchor.place && isExcursionPlace(hotel, anchor.place as LatLng);
    if (!isLocalExcursion && anchorEnd + MEAL_ACTIVITY_GAP <= LATE_BRUNCH_LATEST) {
      notBefore = Math.max(notBefore, anchorEnd + 15);
    } else {
      notBefore = Math.max(notBefore, anchorEnd + MEAL_ACTIVITY_GAP);
    }
  }

  if (excursion?.place?.reservation_time) {
    const anchorEnd = morningAnchorEndMinutes(excursion, hotel);
    if (anchorEnd + MEAL_ACTIVITY_GAP > LATE_BRUNCH_LATEST) {
      return null;
    }
    if (anchorEnd + MEAL_ACTIVITY_GAP + window.duration > lunchEndBoundary) {
      return null;
    }
  }

  let notAfter = latestStart;
  if (notBefore <= MEAL_WINDOWS.breakfast.end) {
    notAfter = Math.min(MEAL_WINDOWS.breakfast.end, latestStart);
  } else if (notBefore <= LATE_BRUNCH_LATEST) {
    notAfter = Math.min(LATE_BRUNCH_LATEST, latestStart);
  }

  if (notBefore > notAfter) return null;
  return { notBefore, notAfter };
}

/** Human-readable reason when breakfast cannot be inserted. */
export function breakfastInsertionSkipReason(
  stops: MealSlotStop[],
  date: string,
  hotel: LatLng,
  openingHours?: OpeningHours | null
): string | null {
  if (breakfastBounds(stops, date, hotel, openingHours) != null) return null;

  const morningAnchors = morningReservationAnchors(stops);
  const excursion = morningAnchors.find(
    (s) => s.place && isExcursionPlace(hotel, s.place as LatLng)
  );
  if (excursion?.place?.reservation_time) {
    const anchorEnd = morningAnchorEndMinutes(excursion, hotel);
    if (anchorEnd + MEAL_ACTIVITY_GAP > LATE_BRUNCH_LATEST) {
      return "excursion day — breakfast cannot fit in late-brunch window after early anchor";
    }
    const lunchStart = earliestMealStart(stops, "lunch");
    const lunchEndBoundary = lunchEndBoundaryMinutes(lunchStart);
    if (anchorEnd + MEAL_ACTIVITY_GAP + MEAL_WINDOWS.breakfast.duration > lunchEndBoundary) {
      return "excursion day — breakfast cannot fit before lunch after early anchor";
    }
  }

  return "breakfast/brunch window too tight after morning anchor";
}

/**
 * Whether a new meal can fit without overlapping existing meals.
 * `notAfter` is the latest allowed START minute for the meal.
 */
export function mealInsertionBounds(
  meal: MealType,
  stops: MealSlotStop[],
  date: string,
  hotel: LatLng,
  options?: { openingHours?: OpeningHours | null }
): { notBefore: number; notAfter: number } | null {
  const window = MEAL_WINDOWS[meal];

  if (meal === "breakfast") {
    return breakfastBounds(stops, date, hotel, options?.openingHours);
  }

  if (meal === "lunch") {
    const breakfastEnd = latestMealEnd(stops, "breakfast");
    const dinnerStart = earliestMealStart(stops, "dinner");
    const notBefore = Math.max(
      window.start,
      breakfastEnd != null ? breakfastEnd + MEAL_ACTIVITY_GAP : window.start
    );
    const dinnerEndBoundary =
      (dinnerStart ?? MEAL_WINDOWS.dinner.start) - MEAL_ACTIVITY_GAP;
    const notAfter = Math.min(window.end + 60, dinnerEndBoundary - window.duration);
    if (notBefore > notAfter) return null;
    return { notBefore, notAfter };
  }

  const lunchEnd = latestMealEnd(stops, "lunch");
  const breakfastEnd = latestMealEnd(stops, "breakfast");
  const notBefore = Math.max(
    window.start,
    lunchEnd != null
      ? lunchEnd + MEAL_ACTIVITY_GAP
      : breakfastEnd != null
        ? breakfastEnd + MEAL_ACTIVITY_GAP
        : window.start
  );
  const notAfter = window.end + 90 - window.duration;
  if (notBefore > notAfter) return null;
  return { notBefore, notAfter };
}

/** Resolve a concrete meal start within insertion bounds. Returns null if impossible. */
export function resolveMealStartMinutes(
  date: string,
  meal: MealType,
  openingHours: OpeningHours | null | undefined,
  options: {
    notBefore: number;
    /** Latest allowed START minute. */
    notAfter: number;
    lunchStart?: number | null;
  }
): number | null {
  const window = MEAL_WINDOWS[meal];
  const { notBefore, notAfter } = options;
  const lunchEndBoundary = lunchEndBoundaryMinutes(options.lunchStart ?? null);

  let start = Math.max(window.start, notBefore);
  const earliest = getMealEarliestMinutes(meal, date, openingHours);
  start = Math.max(start, earliest);

  if (meal === "breakfast" && notBefore > MEAL_WINDOWS.breakfast.end) {
    if (notBefore <= LATE_BRUNCH_LATEST) {
      start = Math.max(notBefore, LATE_BRUNCH_EARLIEST);
      start = Math.min(start, LATE_BRUNCH_LATEST, notAfter);
    } else {
      start = Math.min(Math.max(start, notBefore), notAfter);
    }
  } else {
    start = Math.min(start, notAfter);
  }

  const adjusted = adjustStartForOpeningHours(
    date,
    start,
    window.duration,
    "restaurant",
    openingHours,
    notAfter
  );
  if (adjusted != null) start = Math.max(adjusted, earliest);
  start = Math.min(start, notAfter);

  if (start > notAfter) return null;
  if (meal === "breakfast" && start + window.duration > lunchEndBoundary) {
    return null;
  }

  return start;
}

/** IDs of duplicate or chronologically invalid meal stops to remove. */
export function mealStopsToRemove(stops: MealSlotStop[]): string[] {
  const toRemove = new Set<string>();
  const bestByMeal = new Map<MealType, MealSlotStop>();
  const lunchStart = earliestMealStart(stops, "lunch");
  const reservedLunch = stops.some(
    (s) => effectiveMealType(s) === "lunch" && Boolean(s.place?.reservation_time)
  );

  for (const stop of stops) {
    const meal = effectiveMealType(stop);
    if (!meal || !stop.id) continue;

    const start = stopStartMinutes(stop);
    if (meal === "breakfast" && start != null && start >= MEAL_WINDOWS.lunch.start) {
      toRemove.add(stop.id);
      continue;
    }

    if (
      meal === "breakfast" &&
      lunchStart != null &&
      !isSacredReservation(stop) &&
      reservedLunch
    ) {
      const end = stopEndMinutes(stop);
      if (end != null && end + MEAL_ACTIVITY_GAP > lunchStart) {
        toRemove.add(stop.id);
        continue;
      }
    }

    const existing = bestByMeal.get(meal);
    if (!existing) {
      bestByMeal.set(meal, stop);
      continue;
    }

    const keepReserved = (s: MealSlotStop) => isSacredReservation(s);
    if (keepReserved(stop) && !keepReserved(existing)) {
      toRemove.add(existing.id!);
      bestByMeal.set(meal, stop);
      continue;
    }
    if (keepReserved(existing) && !keepReserved(stop)) {
      toRemove.add(stop.id);
      continue;
    }

    if (
      meal === "lunch" &&
      reservedLunch &&
      keepReserved(existing) &&
      !keepReserved(stop)
    ) {
      toRemove.add(stop.id);
      continue;
    }

    const startA = stopStartMinutes(existing) ?? 9999;
    const startB = stopStartMinutes(stop) ?? 9999;
    if (meal === "breakfast") {
      if (startB < startA) {
        toRemove.add(existing.id!);
        bestByMeal.set(meal, stop);
      } else {
        toRemove.add(stop.id);
      }
    } else if (startB > startA) {
      toRemove.add(existing.id!);
      bestByMeal.set(meal, stop);
    } else {
      toRemove.add(stop.id);
    }
  }

  return [...toRemove];
}
