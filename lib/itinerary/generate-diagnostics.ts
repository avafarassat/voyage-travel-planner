import { dayMissingMeals } from "@/lib/itinerary/meal-locations";

const EXPECTED_MIN_STOPS = 5;

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
