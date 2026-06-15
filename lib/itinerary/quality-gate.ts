import type { MealType } from "@/lib/itinerary/hours";
import {
  dayMissingMeals,
  getActivityLocations,
  isExcursionDay,
} from "@/lib/itinerary/meal-locations";
import type { SmartItineraryDay } from "@/lib/itinerary/smart-generate";

const MIN_STOPS_PER_DAY_DENSITY = 4;
const MIN_TOTAL_STOPS_MULTIPLIER = 4;
const LOW_SIGHTSEEING_THRESHOLD = 2;
const LOW_DENSITY_DAY_FRACTION_BLOCK = 0.45;
const INCOMPLETE_MEAL_DAY_FRACTION_BLOCK = 0.6;
const EXISTING_STOP_REGRESSION_RATIO = 0.65;

export interface ExistingItineraryStats {
  dayCount: number;
  stopCount: number;
  missingMealDayCount: number;
}

export interface QualityGateDayDiagnostics {
  dayNumber: number;
  date: string;
  stopCount: number;
  missingMeals: MealType[];
  toleratedMissingMeals: MealType[];
  lowDensity: boolean;
  lowSightseeing: boolean;
  sightseeingCount: number;
}

export interface QualityGateDiagnostics {
  dayCount: number;
  stopCount: number;
  missingMealsByDay: QualityGateDayDiagnostics[];
  lowDensityDays: { dayNumber: number; stopCount: number }[];
  lowSightseeingDays: { dayNumber: number; sightseeingCount: number }[];
  severeImbalance: boolean;
  existingDayCount?: number;
  existingStopCount?: number;
  existingMissingMealDayCount?: number;
  totalMissingMealSlots: number;
  incompleteMealDayCount: number;
  toleratedIncompleteMealDayCount: number;
}

export interface QualityGateResult {
  shouldBlockReplacement: boolean;
  severity: "ok" | "warning" | "block";
  reasons: string[];
  diagnostics: QualityGateDiagnostics;
}

function countSightseeing(stops: SmartItineraryDay["stops"]): number {
  return stops.filter((s) => {
    if (s.mealType || s.stopType === "meal") return false;
    const cat = s.place?.category ?? s.suggestedPlace?.category;
    return cat === "monument" || cat === "museum" || cat === "activity";
  }).length;
}

function getToleratedMissingMeals(
  hotel: { lat: number; lng: number },
  stops: SmartItineraryDay["stops"],
  missing: MealType[]
): MealType[] {
  if (missing.length === 0) return [];
  const activityLocs = getActivityLocations(stops);
  if (!isExcursionDay(hotel, activityLocs)) return [];
  if (missing.length === 1 && missing[0] === "breakfast") {
    return ["breakfast"];
  }
  return [];
}

function isSevereImbalance(dayStopCounts: number[]): boolean {
  if (dayStopCounts.length < 3) return false;
  const max = Math.max(...dayStopCounts);
  const min = Math.min(...dayStopCounts);
  const avg = dayStopCounts.reduce((sum, count) => sum + count, 0) / dayStopCounts.length;
  if (min <= 2 && max >= 6 && max >= avg * 1.8) return true;
  const veryLowDays = dayStopCounts.filter((count) => count <= 2).length;
  return veryLowDays >= 2 && max >= 5;
}

function mealCheckStopsFromGenerated(day: SmartItineraryDay) {
  return day.stops.map((s) => ({
    mealType: s.mealType,
    stopType: s.stopType,
    scheduledTime: s.scheduledTime,
    duration_minutes: s.durationMinutes,
    place: s.place
      ? {
          category: s.place.category,
          reservation_time: s.place.reservation_time,
        }
      : s.suggestedPlace
        ? { category: s.suggestedPlace.category }
        : null,
  }));
}

export function evaluateItineraryQualityGate(params: {
  generatedDays: SmartItineraryDay[];
  tripDayCount: number;
  hotel: { lat: number; lng: number };
  existing?: ExistingItineraryStats | null;
}): QualityGateResult {
  const { generatedDays, tripDayCount, hotel, existing } = params;
  const reasons: string[] = [];
  let severity: QualityGateResult["severity"] = "ok";

  const dayCount = generatedDays.length;
  const stopCount = generatedDays.reduce((sum, day) => sum + day.stops.length, 0);
  const dayStopCounts = generatedDays.map((day) => day.stops.length);
  const hasExistingItinerary = (existing?.stopCount ?? 0) > 0;

  const missingMealsByDay: QualityGateDayDiagnostics[] = [];
  const lowDensityDays: { dayNumber: number; stopCount: number }[] = [];
  const lowSightseeingDays: { dayNumber: number; sightseeingCount: number }[] = [];
  let incompleteMealDayCount = 0;
  let toleratedIncompleteMealDayCount = 0;
  let totalMissingMealSlots = 0;

  for (const day of generatedDays) {
    const missing = dayMissingMeals(mealCheckStopsFromGenerated(day)) as MealType[];
    const toleratedMissingMeals = getToleratedMissingMeals(hotel, day.stops, missing);
    const significantMissing = missing.filter((meal) => !toleratedMissingMeals.includes(meal));

    if (missing.length > 0) {
      if (significantMissing.length > 0) incompleteMealDayCount += 1;
      else toleratedIncompleteMealDayCount += 1;
      totalMissingMealSlots += significantMissing.length;
    }

    const sightseeingCount = countSightseeing(day.stops);
    const lowDensity = day.stops.length < MIN_STOPS_PER_DAY_DENSITY;
    const lowSightseeing = sightseeingCount < LOW_SIGHTSEEING_THRESHOLD;

    if (lowDensity) {
      lowDensityDays.push({ dayNumber: day.dayNumber, stopCount: day.stops.length });
    }
    if (lowSightseeing) {
      lowSightseeingDays.push({ dayNumber: day.dayNumber, sightseeingCount });
    }

    missingMealsByDay.push({
      dayNumber: day.dayNumber,
      date: day.date,
      stopCount: day.stops.length,
      missingMeals: missing,
      toleratedMissingMeals,
      lowDensity,
      lowSightseeing,
      sightseeingCount,
    });
  }

  const severeImbalance = isSevereImbalance(dayStopCounts);
  const minTotalStops =
    tripDayCount >= 2 ? tripDayCount * MIN_TOTAL_STOPS_MULTIPLIER : 4;
  const lowDensityThreshold = Math.max(2, Math.ceil(dayCount * LOW_DENSITY_DAY_FRACTION_BLOCK));
  const incompleteMealThreshold = Math.ceil(dayCount * INCOMPLETE_MEAL_DAY_FRACTION_BLOCK);

  let blocked = false;
  const markBlock = (reason: string) => {
    reasons.push(reason);
    blocked = true;
  };

  if (dayCount === 0) markBlock("generated_day_count_zero");
  if (stopCount === 0) markBlock("generated_stop_count_zero");

  if (tripDayCount >= 2 && stopCount > 0 && stopCount < minTotalStops) {
    markBlock(`total_stops_below_minimum:${stopCount}<${minTotalStops}`);
  }

  if (dayCount >= 2 && lowDensityDays.length >= lowDensityThreshold) {
    markBlock(`too_many_low_density_days:${lowDensityDays.length}`);
  }

  if (dayCount > 0 && incompleteMealDayCount >= incompleteMealThreshold) {
    markBlock(`too_many_incomplete_meal_days:${incompleteMealDayCount}`);
  }

  const missingCoreMealDays = missingMealsByDay.filter((day) => {
    const significant = day.missingMeals.filter(
      (meal) => !day.toleratedMissingMeals.includes(meal)
    );
    return significant.includes("lunch") && significant.includes("dinner");
  }).length;
  if (dayCount >= 2 && missingCoreMealDays >= Math.ceil(dayCount * 0.4)) {
    markBlock(`too_many_days_missing_lunch_and_dinner:${missingCoreMealDays}`);
  }

  const missingLunchOrDinnerDays = missingMealsByDay.filter((day) => {
    const significant = day.missingMeals.filter(
      (meal) => !day.toleratedMissingMeals.includes(meal)
    );
    return significant.includes("lunch") || significant.includes("dinner");
  }).length;
  if (dayCount >= 3 && missingLunchOrDinnerDays >= Math.ceil(dayCount * 0.55)) {
    markBlock(`most_days_missing_lunch_or_dinner:${missingLunchOrDinnerDays}`);
  }

  if (severeImbalance) markBlock("severe_day_stop_imbalance");

  if (hasExistingItinerary && existing) {
    const regressionThreshold = Math.floor(existing.stopCount * EXISTING_STOP_REGRESSION_RATIO);
    if (stopCount < regressionThreshold) {
      markBlock(
        `stop_count_regression:${stopCount}<${regressionThreshold}_existing_${existing.stopCount}`
      );
    }
    if (
      existing.missingMealDayCount <= 1 &&
      incompleteMealDayCount >= incompleteMealThreshold &&
      existing.stopCount >= minTotalStops
    ) {
      markBlock("meal_quality_regression_vs_existing");
    }
  }

  if (!blocked) {
    if (incompleteMealDayCount > 0) {
      reasons.push(`incomplete_meal_days:${incompleteMealDayCount}`);
      severity = "warning";
    }

    if (lowDensityDays.length > 0 && lowDensityDays.length < lowDensityThreshold) {
      reasons.push(`some_low_density_days:${lowDensityDays.length}`);
      severity = "warning";
    }

    const overallHealthy =
      stopCount >= minTotalStops &&
      incompleteMealDayCount <= 1 &&
      lowDensityDays.length <= 1;

    if (lowSightseeingDays.length === 1 && !overallHealthy) {
      reasons.push(`low_sightseeing_day:${lowSightseeingDays[0].dayNumber}`);
      severity = "warning";
    } else if (lowSightseeingDays.length >= 2) {
      reasons.push(`multiple_low_sightseeing_days:${lowSightseeingDays.length}`);
      severity = "warning";
    }

    if (
      hasExistingItinerary &&
      existing &&
      stopCount < existing.stopCount * 0.85 &&
      stopCount >= Math.floor(existing.stopCount * EXISTING_STOP_REGRESSION_RATIO)
    ) {
      reasons.push("fewer_stops_than_existing");
      severity = "warning";
    }
  } else {
    severity = "block";
  }

  const shouldBlockReplacement = blocked && hasExistingItinerary;

  return {
    shouldBlockReplacement,
    severity,
    reasons,
    diagnostics: {
      dayCount,
      stopCount,
      missingMealsByDay,
      lowDensityDays,
      lowSightseeingDays,
      severeImbalance,
      existingDayCount: existing?.dayCount,
      existingStopCount: existing?.stopCount,
      existingMissingMealDayCount: existing?.missingMealDayCount,
      totalMissingMealSlots,
      incompleteMealDayCount,
      toleratedIncompleteMealDayCount,
    },
  };
}
