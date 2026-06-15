import { dayMissingMeals } from "@/lib/itinerary/meal-locations";
import type { MealType } from "@/lib/itinerary/hours";
import { QUOTA_EXHAUSTED_USER_MESSAGE } from "@/lib/itinerary/places-quota-gate";
import type { QualityGateResult } from "@/lib/itinerary/quality-gate";

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

export type PlaceHydrationLogStats = {
  fromStoredDb: number;
  fromDestinationPool: number;
  scheduleUsableWithoutHours: number;
  liveDetailsAttempted: number;
  skippedQuota: number;
  missingCoordinates: number;
};

/** Log pre-generate place hydration sources (stored DB / pool / live). */
export function logStoredPlaceHydration(stats: PlaceHydrationLogStats): void {
  console.info("[itinerary-generate] stored_place_hydration", stats);
}

/** Log post-generate place hydration after fill-sparse / ensure-meals (stored DB / pool / live). */
export function logPostGeneratePlaceHydration(stats: PlaceHydrationLogStats): void {
  console.info("[itinerary-generate] post_generate_place_hydration", stats);
}

/** Log candidate pool sizes once per Generate (no API keys). */
export function logGeneratePoolStats(stats: GeneratePoolStats): void {
  console.info("[itinerary-generate] pools", stats);
}

/** Log quality gate evaluation before replacing an existing itinerary. */
export function logQualityGate(
  result: QualityGateResult,
  hasExistingItinerary: boolean
): void {
  const logFn = result.severity === "block" ? console.warn : console.info;
  logFn("[itinerary-generate] quality_gate", {
    severity: result.severity,
    shouldBlockReplacement: result.shouldBlockReplacement,
    hasExistingItinerary,
    reasons: result.reasons,
    generatedDayCount: result.diagnostics.dayCount,
    generatedStopCount: result.diagnostics.stopCount,
    existingDayCount: result.diagnostics.existingDayCount ?? 0,
    existingStopCount: result.diagnostics.existingStopCount ?? 0,
    missingMealCount: result.diagnostics.totalMissingMealSlots,
    incompleteMealDayCount: result.diagnostics.incompleteMealDayCount,
    toleratedIncompleteMealDayCount: result.diagnostics.toleratedIncompleteMealDayCount,
    lowDensityDays: result.diagnostics.lowDensityDays.length,
    lowSightseeingDays: result.diagnostics.lowSightseeingDays.length,
    severeImbalance: result.diagnostics.severeImbalance,
  });
}

/** Log density repair start for a low-sightseeing day. */
export function logDensityRepairStart(params: {
  dayNumber: number;
  date: string;
  startingSightseeing: number;
  targetSightseeing: number;
  poolSize: number;
}): void {
  console.info("[itinerary-generate] density_repair_start", params);
}

/** Log a stop added during density repair. */
export function logDensityRepairAdded(params: {
  dayNumber: number;
  date: string;
  placeId: string;
  name: string;
  category: string;
  scheduledTime: string;
  sightseeingCount: number;
}): void {
  console.info("[itinerary-generate] density_repair_added", params);
}

/** Log when a day is skipped by density repair. */
export function logDensityRepairSkipped(params: {
  dayNumber: number;
  date: string;
  reason: string;
  startingSightseeing: number;
  targetSightseeing: number;
}): void {
  console.info("[itinerary-generate] density_repair_skipped", params);
}

/** Per-day or trip-level density repair summary. */
export function logDensityRepairSummary(
  params:
    | {
        dayNumber: number;
        date: string;
        startingSightseeing: number;
        targetSightseeing: number;
        finalSightseeing: number;
        candidatesConsidered: number;
        addedCount: number;
        skippedReasons: Record<string, number>;
      }
    | {
        tripLevel: true;
        daysConsidered: number;
        daysRepaired: number;
        totalAdded: number;
        totalCandidatesConsidered: number;
        totalAttempts: number;
        skippedReasons: Record<string, number>;
      }
): void {
  console.info("[itinerary-generate] density_repair_summary", params);
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
