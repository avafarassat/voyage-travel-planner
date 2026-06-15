import { dayMissingMeals } from "@/lib/itinerary/meal-locations";
import type { MealType } from "@/lib/itinerary/hours";
import { QUOTA_EXHAUSTED_USER_MESSAGE } from "@/lib/itinerary/places-quota-gate";

const EXPECTED_MIN_STOPS = 5;

export interface MealRejectionCounts {
  usedGoogleId: number;
  duplicateBrand: number;
  manualPlaceExcluded: number;
  invalidMealCandidate: number;
  closedOrHoursFailed: number;
  outsideMealWindow: number;
  deadlineOrDayEndFailed: number;
  noCandidates: number;
}

export function emptyMealRejectionCounts(): MealRejectionCounts {
  return {
    usedGoogleId: 0,
    duplicateBrand: 0,
    manualPlaceExcluded: 0,
    invalidMealCandidate: 0,
    closedOrHoursFailed: 0,
    outsideMealWindow: 0,
    deadlineOrDayEndFailed: 0,
    noCandidates: 0,
  };
}

/** Summarized log when a meal slot could not be filled during generation. */
export function logMealNotPlaced(params: {
  phase: string;
  date: string;
  dayNumber?: number;
  meal: MealType;
  candidateCount: number;
  rejections: MealRejectionCounts;
  reason?: string;
  mode?: string;
}): void {
  console.warn("[itinerary-generate] meal_not_placed", params);
}

export interface MissingMealsDaySummary {
  dayNumber: number;
  date: string;
  missing: MealType[];
}

/** Log persisted meal gaps after all post-generate passes complete. */
export function logMissingMealsAfterGeneration(
  days: MissingMealsDaySummary[]
): void {
  const incomplete = days.filter((d) => d.missing.length > 0);
  if (incomplete.length === 0) {
    console.info("[itinerary-generate] missing_meals_after_generation", {
      allDaysComplete: true,
      dayCount: days.length,
    });
    return;
  }

  console.warn("[itinerary-generate] missing_meals_after_generation", {
    dayCount: days.length,
    incompleteDayCount: incomplete.length,
    days: incomplete.map((d) => ({
      day: d.dayNumber,
      date: d.date,
      missing: d.missing,
    })),
  });
}

/** Non-blocking user-facing warning when many days still lack core meals. */
export function buildMealGapWarning(
  days: MissingMealsDaySummary[],
  totalDays: number
): string | undefined {
  if (totalDays === 0 || days.length === 0) return undefined;

  const incomplete = days.filter((d) => d.missing.length > 0);
  if (incomplete.length === 0) return undefined;

  const severe =
    incomplete.length >= Math.ceil(totalDays * 0.6) ||
    incomplete.every((d) => d.missing.length >= 2);

  if (severe) {
    return "Your itinerary was created, but many days are still missing breakfast, lunch, or dinner. Add restaurants manually or try generating again later.";
  }

  if (incomplete.length === 1) {
    const day = incomplete[0];
    return `Day ${day.dayNumber} is missing ${day.missing.join(", ")}. You can add restaurants manually on the Plan tab.`;
  }

  return `${incomplete.length} days are missing one or more meals. You can add restaurants manually on the Plan tab.`;
}

function isMateriallyIncompleteMeals(
  days: MissingMealsDaySummary[],
  totalDays: number
): boolean {
  if (totalDays === 0 || days.length === 0) return false;
  const incomplete = days.filter((d) => d.missing.length > 0);
  if (incomplete.length === 0) return false;
  return (
    incomplete.length >= Math.ceil(totalDays * 0.6) ||
    incomplete.some((d) => d.missing.length >= 2)
  );
}

/** Merge meal-gap and quota-exhaustion warnings for Generate responses. */
export function buildGenerateWarning(
  days: MissingMealsDaySummary[],
  totalDays: number,
  quotaExhausted: boolean
): string | undefined {
  if (quotaExhausted && isMateriallyIncompleteMeals(days, totalDays)) {
    return QUOTA_EXHAUSTED_USER_MESSAGE;
  }
  return buildMealGapWarning(days, totalDays);
}

export interface GeneratePoolStats {
  interestPoolCount: number;
  restaurantPoolCount: number;
  parksPoolCount: number;
  experiencesPoolCount: number;
  suggestionPoolCount: number;
  mealPrefetchSlots: number;
  manualPlaceCount: number;
  tripDayCount: number;
}

export interface GeneratedDaySummary {
  dayNumber: number;
  date: string;
  stopCount: number;
}

/** Log once when Generate begins (no API keys). */
export function logGenerateStart(params: {
  tripId: string;
  tripDayCount: number;
}): void {
  console.info("[itinerary-generate] start", params);
}

/** Log pre-generate place hydration sources (stored DB / pool / live). */
export function logStoredPlaceHydration(stats: {
  fromStoredDb: number;
  fromDestinationPool: number;
  liveDetailsAttempted: number;
  skippedQuota: number;
  missingCoordinates: number;
}): void {
  console.info("[itinerary-generate] stored_place_hydration", stats);
}

/** Log candidate pool sizes once per Generate (no API keys). */
export function logGeneratePoolStats(stats: GeneratePoolStats): void {
  console.info("[itinerary-generate] pools", stats);
}

/** Log trip-level generation outcome once scheduling completes. */
export function logGenerateResult(
  days: GeneratedDaySummary[],
  totalStops: number
): void {
  console.info("[itinerary-generate] result", {
    dayCount: days.length,
    stopCount: totalStops,
    perDay: days.map((d) => ({ day: d.dayNumber, stops: d.stopCount })),
  });
}

type DayStopForDiagnostics = {
  stopType?: string;
  stop_type?: string;
  mealType?: string | null;
  meal_type?: string | null;
  scheduledTime?: string | null;
  scheduled_time?: string | null;
  duration_minutes?: number | null;
  place?: {
    category?: string;
    reservation_time?: string | null;
    source?: string;
  } | null;
  suggestedPlace?: { category?: string } | null;
};

/** Warn when a day is below minimum stops or missing meals after scheduling. */
export function logDayScheduleDiagnostics(
  dayNumber: number,
  date: string,
  stops: DayStopForDiagnostics[]
): void {
  const issues: string[] = [];

  if (stops.length < EXPECTED_MIN_STOPS) {
    issues.push(`low_stop_count:${stops.length}<${EXPECTED_MIN_STOPS}`);
  }

  const mealCheckStops = stops.map((s) => ({
    meal_type: s.mealType ?? s.meal_type,
    stop_type: s.stopType ?? s.stop_type,
    scheduled_time: s.scheduledTime ?? s.scheduled_time,
    duration_minutes: s.duration_minutes,
    place: s.place
      ? {
          category: s.place.category,
          reservation_time: s.place.reservation_time,
        }
      : s.suggestedPlace
        ? { category: s.suggestedPlace.category }
        : null,
  }));

  const missingMeals = dayMissingMeals(mealCheckStops);
  if (missingMeals.length > 0) {
    issues.push(`missing_meals:${missingMeals.join(",")}`);
  }

  const sightseeing = stops.filter((s) => {
    const meal = s.mealType ?? s.meal_type;
    if (meal) return false;
    const cat = s.place?.category ?? s.suggestedPlace?.category;
    return cat === "monument" || cat === "museum" || cat === "activity";
  }).length;
  if (sightseeing < 2) {
    issues.push(`low_sightseeing:${sightseeing}`);
  }

  if (issues.length === 0) return;

  console.warn("[itinerary-generate] day_below_target", {
    dayNumber,
    date,
    stopCount: stops.length,
    issues,
  });
}
