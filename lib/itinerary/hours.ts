import type { PlaceCategory } from "@/lib/types";

export interface OpeningPeriod {
  open: { day: number; time: string };
  close?: { day: number; time: string };
}

export interface OpeningHours {
  periods?: OpeningPeriod[];
  weekday_text?: string[];
}

/** Minutes from midnight, e.g. "0930" → 570 */
export function parseGoogleTime(time: string): number {
  const h = parseInt(time.slice(0, 2), 10);
  const m = parseInt(time.slice(2, 4), 10);
  return h * 60 + m;
}

export function minutesToTimeString(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Default open windows when Google hours are unavailable. */
const CATEGORY_DEFAULT_HOURS: Record<
  PlaceCategory,
  { earliest: number; latest: number; visitMinutes: number }
> = {
  restaurant: { earliest: 8 * 60, latest: 22 * 60, visitMinutes: 75 },
  bar: { earliest: 17 * 60, latest: 24 * 60 + 120, visitMinutes: 60 },
  nightlife: { earliest: 21 * 60, latest: 24 * 60 + 180, visitMinutes: 120 },
  activity: { earliest: 9 * 60, latest: 20 * 60, visitMinutes: 120 },
  monument: { earliest: 9 * 60, latest: 19 * 60, visitMinutes: 90 },
  museum: { earliest: 10 * 60, latest: 18 * 60, visitMinutes: 120 },
};

export function getDefaultVisitMinutes(category: PlaceCategory): number {
  return CATEGORY_DEFAULT_HOURS[category].visitMinutes;
}

export function getCategoryEarliestOpen(category: PlaceCategory): number {
  return CATEGORY_DEFAULT_HOURS[category].earliest;
}

/** Earliest allowed start for a meal slot — breakfast defaults to 9 AM when hours unknown. */
export function getMealEarliestMinutes(
  meal: MealType,
  dateStr: string,
  openingHours?: OpeningHours | null
): number {
  const venueOpen = getEarliestOpenMinutes(dateStr, "restaurant", openingHours);
  if (meal === "breakfast") {
    return Math.max(venueOpen, 9 * 60);
  }
  return venueOpen;
}

export function getCategoryLatestOpen(category: PlaceCategory): number {
  return CATEGORY_DEFAULT_HOURS[category].latest;
}

function getJsDayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay();
}

const JS_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function parseClockToken(h: number, m: number, ampm?: string): number {
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === "PM" && h < 12) h += 12;
    if (upper === "AM" && h === 12) h = 0;
  }
  return h * 60 + m;
}

function parseWeekdayTextHours(
  dateStr: string,
  weekdayText: string[]
): { earliest: number; latest: number } | null {
  const dayName = JS_DAY_NAMES[getJsDayOfWeek(dateStr)];
  const line = weekdayText.find((t) => t.startsWith(dayName));
  if (!line || /closed/i.test(line)) return null;

  const matches = [...line.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi)];
  if (matches.length === 0) return null;

  const open = parseClockToken(
    parseInt(matches[0][1], 10),
    parseInt(matches[0][2], 10),
    matches[0][3]
  );
  const closeMatch = matches[matches.length - 1];
  let close = parseClockToken(
    parseInt(closeMatch[1], 10),
    parseInt(closeMatch[2], 10),
    closeMatch[3]
  );
  if (close <= open) close += 24 * 60;
  return { earliest: open, latest: close };
}

function periodCoversTime(
  period: OpeningPeriod,
  jsDay: number,
  startMinutes: number,
  endMinutes: number
): boolean {
  if (period.open.day !== jsDay) return false;
  const openMin = parseGoogleTime(period.open.time);
  const closeMin = period.close ? parseGoogleTime(period.close.time) : 24 * 60;
  if (closeMin < openMin) {
    return startMinutes >= openMin || endMinutes <= closeMin;
  }
  return startMinutes >= openMin && endMinutes <= closeMin;
}

/** True if the place can host a visit starting at startMinutes for durationMinutes. */
export function isOpenAt(
  dateStr: string,
  startMinutes: number,
  durationMinutes: number,
  category: PlaceCategory,
  hours?: OpeningHours | null
): boolean {
  const endMinutes = startMinutes + durationMinutes;
  const jsDay = getJsDayOfWeek(dateStr);

  if (hours?.periods?.length) {
    return hours.periods.some((p) =>
      periodCoversTime(p, jsDay, startMinutes, endMinutes)
    );
  }

  const defaults = CATEGORY_DEFAULT_HOURS[category];
  return startMinutes >= defaults.earliest && endMinutes <= defaults.latest;
}

/** Earliest minute on dateStr the venue opens (from Google hours or category defaults). */
export function getEarliestOpenMinutes(
  dateStr: string,
  category: PlaceCategory,
  hours?: OpeningHours | null
): number {
  const jsDay = getJsDayOfWeek(dateStr);
  if (hours?.periods?.length) {
    const opens = hours.periods
      .filter((p) => p.open.day === jsDay)
      .map((p) => parseGoogleTime(p.open.time));
    if (opens.length > 0) return Math.min(...opens);
  }
  if (hours?.weekday_text?.length) {
    const parsed = parseWeekdayTextHours(dateStr, hours.weekday_text);
    if (parsed) return parsed.earliest;
  }
  return CATEGORY_DEFAULT_HOURS[category].earliest;
}

function getLatestCloseMinutes(
  dateStr: string,
  category: PlaceCategory,
  hours?: OpeningHours | null
): number {
  const jsDay = getJsDayOfWeek(dateStr);
  if (hours?.periods?.length) {
    const closes = hours.periods
      .filter((p) => p.open.day === jsDay && p.close)
      .map((p) => parseGoogleTime(p.close!.time));
    if (closes.length > 0) return Math.max(...closes);
  }
  if (hours?.weekday_text?.length) {
    const parsed = parseWeekdayTextHours(dateStr, hours.weekday_text);
    if (parsed) return parsed.latest;
  }
  return CATEGORY_DEFAULT_HOURS[category].latest;
}

/** Bump start forward until the visit fits opening hours, or return null if impossible that day. */
export function adjustStartForOpeningHours(
  dateStr: string,
  startMinutes: number,
  durationMinutes: number,
  category: PlaceCategory,
  hours?: OpeningHours | null,
  latestStart?: number
): number | null {
  const cap = latestStart ?? CATEGORY_DEFAULT_HOURS[category].latest - durationMinutes;
  let start = Math.max(startMinutes, getEarliestOpenMinutes(dateStr, category, hours));

  if (start > cap) return null;

  if (isOpenAt(dateStr, start, durationMinutes, category, hours)) {
    return start;
  }

  if (hours?.periods?.length) {
    const jsDay = getJsDayOfWeek(dateStr);
    for (const period of hours.periods) {
      if (period.open.day !== jsDay) continue;
      const openMin = parseGoogleTime(period.open.time);
      const closeMin = period.close ? parseGoogleTime(period.close.time) : 24 * 60;
      const candidate = Math.max(startMinutes, openMin);
      if (candidate <= cap && candidate + durationMinutes <= closeMin) {
        return candidate;
      }
    }
    return null;
  }

  return start <= cap ? start : null;
}

/** Meal windows (minutes from midnight). */
export const MEAL_WINDOWS = {
  breakfast: { label: "Breakfast", start: 8 * 60, end: 10 * 60, duration: 60 },
  lunch: { label: "Lunch", start: 12 * 60, end: 14 * 60, duration: 75 },
  dinner: { label: "Dinner", start: 19 * 60, end: 21 * 60, duration: 90 },
} as const;

export type MealType = keyof typeof MEAL_WINDOWS;

/** Final arrival minute for a meal — honors window, pre-placed time, venue hours, and optional cap. */
export function resolveMealArrivalMinutes(
  dateStr: string,
  travelArrival: number,
  placedMinutes: number | null,
  meal: MealType,
  durationMinutes: number,
  openingHours?: OpeningHours | null,
  options?: { latestStart?: number; notBefore?: number }
): number {
  const window = MEAL_WINDOWS[meal];

  let arrival = Math.max(travelArrival, window.start);
  if (placedMinutes != null) {
    arrival = Math.max(arrival, placedMinutes);
  }
  if (options?.notBefore != null) {
    arrival = Math.max(arrival, options.notBefore);
  }

  const mealEarliest = getMealEarliestMinutes(meal, dateStr, openingHours);
  arrival = Math.max(arrival, mealEarliest);

  const cap = options?.latestStart ?? window.end;
  const adjusted = adjustStartForOpeningHours(
    dateStr,
    arrival,
    durationMinutes,
    "restaurant",
    openingHours,
    cap
  );
  if (adjusted != null) {
    arrival = Math.max(adjusted, mealEarliest);
  }

  if (options?.latestStart != null) {
    if (mealEarliest > options.latestStart) {
      return Math.max(arrival, mealEarliest);
    }
    arrival = Math.min(arrival, options.latestStart);
  }

  return arrival;
}

/** Map a reservation or meal time to breakfast / lunch / dinner. */
export function inferMealTypeFromMinutes(minutes: number): MealType | null {
  if (
    minutes >= MEAL_WINDOWS.breakfast.start &&
    minutes <= MEAL_WINDOWS.breakfast.end + 60
  ) {
    return "breakfast";
  }
  if (minutes >= MEAL_WINDOWS.lunch.start - 30 && minutes < 16 * 60) {
    return "lunch";
  }
  if (minutes >= 16 * 60 && minutes <= MEAL_WINDOWS.dinner.end + 90) {
    return "dinner";
  }
  return null;
}

export function isMealAppropriateTime(meal: MealType, startMinutes: number): boolean {
  return inferMealTypeFromMinutes(startMinutes) === meal;
}

export function isCategoryAppropriateAtTime(
  category: PlaceCategory,
  startMinutes: number
): boolean {
  const defaults = CATEGORY_DEFAULT_HOURS[category];
  return startMinutes >= defaults.earliest && startMinutes <= defaults.latest - 30;
}

export interface VisitTimeOptions {
  outdoor?: boolean;
  experience?: boolean;
}

/** Whether a visit can start at startMinutes for the given duration. */
export function isVisitAppropriateAtTime(
  category: PlaceCategory,
  startMinutes: number,
  durationMinutes: number,
  options?: VisitTimeOptions
): boolean {
  if (options?.outdoor) {
    return startMinutes >= 9 * 60 && startMinutes + durationMinutes <= 18 * 60;
  }
  if (options?.experience) {
    return startMinutes >= 9 * 60 && startMinutes + durationMinutes <= 18 * 60 + 30;
  }
  const defaults = CATEGORY_DEFAULT_HOURS[category];
  return (
    startMinutes >= defaults.earliest &&
    startMinutes + durationMinutes <= defaults.latest
  );
}

/** Clamp a sightseeing stop to opening hours and sensible time-of-day. */
export function resolveVisitArrivalMinutes(
  dateStr: string,
  travelArrival: number,
  category: PlaceCategory,
  durationMinutes: number,
  hours?: OpeningHours | null,
  options?: VisitTimeOptions
): number | null {
  let latestStart = getLatestCloseMinutes(dateStr, category, hours) - durationMinutes;
  if (options?.outdoor) {
    latestStart = Math.min(latestStart, 18 * 60 - durationMinutes);
  } else if (options?.experience) {
    latestStart = Math.min(latestStart, 18 * 60 + 30 - durationMinutes);
  }

  const adjusted = adjustStartForOpeningHours(
    dateStr,
    travelArrival,
    durationMinutes,
    category,
    hours,
    latestStart
  );
  if (adjusted == null) return null;
  if (!isVisitAppropriateAtTime(category, adjusted, durationMinutes, options)) {
    return null;
  }
  return adjusted;
}
