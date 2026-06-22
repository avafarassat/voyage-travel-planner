import type { LatLng, PlaceCategory, PlaceSearchResult } from "@/lib/types";
import { isSitDownRestaurant } from "@/lib/types";
import { compareStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import {
  MEAL_WINDOWS,
  minutesToTimeString,
  type MealType,
  type OpeningHours,
} from "@/lib/itinerary/hours";
import {
  effectiveLunchStartForBreakfastBounds,
  mealInsertionBounds,
  MEAL_ACTIVITY_GAP,
  resolveMealStartMinutes,
  type MealSlotStop,
} from "@/lib/itinerary/meal-slots";
import { isRestaurantBrandUsed, registerRestaurantBrand } from "@/lib/itinerary/meal-dedup";
import { parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import type { TravelTimeFn } from "@/lib/itinerary/travel";
import { emptyMealRejectionCounts, type MealRejectionCounts } from "@/lib/itinerary/generate-diagnostics";

export interface MealGapStop {
  stopType?: string;
  stop_type?: string;
  mealType?: string | null;
  meal_type?: string | null;
  scheduledTime?: string | null;
  scheduled_time?: string | null;
  durationMinutes?: number | null;
  duration_minutes?: number | null;
  place?: {
    lat?: number;
    lng?: number;
    category?: string;
    reservation_time?: string | null;
    reservation_date?: string | null;
    source?: string;
    name?: string;
  } | null;
  suggestedPlace?: {
    lat: number;
    lng: number;
    category?: string;
    name?: string;
    openingHours?: OpeningHours | null;
  } | null;
  placeId?: string;
}

export interface MealWindowGap {
  /** Earliest valid meal start minute within this gap (before travel adjustment). */
  regionStart: number;
  /** Latest minute the meal may end within this gap. */
  regionEnd: number;
  locationBefore: LatLng;
}

export interface MealGapInsertCandidate {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  openingHours?: OpeningHours | null;
}

export interface MealGapInsertResult {
  success: boolean;
  mealStart?: number;
  candidate?: MealGapInsertCandidate;
  gapsConsidered: number;
  candidateCount: number;
  rejections: MealRejectionCounts;
  skipReason?: string;
}

function stopType(stop: MealGapStop): string | undefined {
  return stop.stopType ?? stop.stop_type;
}

function mealTypeOf(stop: MealGapStop): string | null | undefined {
  return stop.mealType ?? stop.meal_type;
}

function scheduledTimeOf(stop: MealGapStop): string | null | undefined {
  return stop.scheduledTime ?? stop.scheduled_time;
}

function durationOf(stop: MealGapStop, meal?: MealType): number {
  const explicit = stop.durationMinutes ?? stop.duration_minutes;
  if (explicit != null) return explicit;
  const mt = mealTypeOf(stop);
  if (mt && mt in MEAL_WINDOWS) {
    return MEAL_WINDOWS[mt as MealType].duration;
  }
  if (meal) return MEAL_WINDOWS[meal].duration;
  return 75;
}

function stopLocation(stop: MealGapStop, fallback: LatLng): LatLng {
  const place = stop.place ?? stop.suggestedPlace;
  if (place?.lat != null && place.lng != null) {
    return { lat: place.lat, lng: place.lng };
  }
  return fallback;
}

function startMinutesOf(stop: MealGapStop, date: string): number | null {
  const anchor = stop.place?.reservation_time;
  if (anchor && (!stop.place?.reservation_date || stop.place.reservation_date === date)) {
    return parseTimeToMinutes(anchor.slice(0, 8));
  }
  const scheduled = scheduledTimeOf(stop);
  if (!scheduled) return null;
  return parseTimeToMinutes(scheduled.slice(0, 8));
}

function toRhythmShape(stop: MealGapStop, date: string) {
  const place = stop.place ?? stop.suggestedPlace;
  return {
    stop_type: stopType(stop),
    meal_type: mealTypeOf(stop) ?? null,
    scheduled_time: scheduledTimeOf(stop) ?? null,
    place: place
      ? {
          category: place.category as PlaceCategory | undefined,
          reservation_time: stop.place?.reservation_time ?? null,
        }
      : null,
    anchor_time:
      stop.place?.reservation_time &&
      (!stop.place.reservation_date || stop.place.reservation_date === date)
        ? stop.place.reservation_time
        : null,
  };
}

function toMealSlotStops(stops: MealGapStop[]): MealSlotStop[] {
  return stops.map((s) => ({
    id: s.placeId,
    meal_type: mealTypeOf(s),
    stop_type: stopType(s),
    scheduled_time: scheduledTimeOf(s),
    duration_minutes: s.durationMinutes ?? s.duration_minutes,
    place: s.place
      ? {
          category: s.place.category,
          reservation_time: s.place.reservation_time,
          source: s.place.source,
        }
      : null,
  }));
}

/** Intervals that block meal insertion (fixed anchors, rest blocks, existing meals). */
function buildBlockingIntervals(
  stops: MealGapStop[],
  date: string,
  hotel: LatLng
): { start: number; end: number; location: LatLng }[] {
  const sorted = [...stops].sort((a, b) =>
    compareStopsByDayRhythm(toRhythmShape(a, date), toRhythmShape(b, date))
  );

  const intervals: { start: number; end: number; location: LatLng }[] = [];
  for (const stop of sorted) {
    const start = startMinutesOf(stop, date);
    if (start == null) continue;
    const meal = mealTypeOf(stop) as MealType | null | undefined;
    const duration = durationOf(stop, meal ?? undefined);
    intervals.push({
      start,
      end: start + duration,
      location: stopLocation(stop, hotel),
    });
  }
  return intervals.sort((a, b) => a.start - b.start);
}

/**
 * Find open time regions within meal insertion bounds where a meal could fit.
 * Considers existing schedule blocks and preserves anchor/rest spacing via bounds.
 */
export function findMealWindowGaps(
  stops: MealGapStop[],
  meal: MealType,
  bounds: { notBefore: number; notAfter: number },
  hotel: LatLng,
  dayEndMinutes: number,
  date: string
): MealWindowGap[] {
  const window = MEAL_WINDOWS[meal];
  const blocking = buildBlockingIntervals(stops, date, hotel);
  const gaps: MealWindowGap[] = [];

  const windowRegionStart = bounds.notBefore;
  const windowRegionEnd = Math.min(bounds.notAfter + window.duration, dayEndMinutes);

  if (windowRegionEnd - windowRegionStart < window.duration) {
    return gaps;
  }

  const tryAddGap = (regionStart: number, regionEnd: number, locationBefore: LatLng) => {
    const earliestStart = Math.max(regionStart, bounds.notBefore);
    const latestStart = Math.min(regionEnd - window.duration, bounds.notAfter);
    if (earliestStart <= latestStart) {
      gaps.push({ regionStart: earliestStart, regionEnd: regionEnd, locationBefore });
    }
  };

  if (blocking.length === 0) {
    tryAddGap(windowRegionStart, windowRegionEnd, hotel);
    return gaps;
  }

  // Gap before first blocking interval
  tryAddGap(
    windowRegionStart,
    Math.min(blocking[0].start - MEAL_ACTIVITY_GAP, windowRegionEnd),
    hotel
  );

  for (let i = 0; i < blocking.length - 1; i++) {
    const prev = blocking[i];
    const next = blocking[i + 1];
    const gapStart = prev.end + MEAL_ACTIVITY_GAP;
    const gapEnd = next.start - MEAL_ACTIVITY_GAP;
    if (gapEnd - gapStart >= window.duration) {
      tryAddGap(
        Math.max(gapStart, windowRegionStart),
        Math.min(gapEnd, windowRegionEnd),
        prev.location
      );
    }
  }

  const last = blocking[blocking.length - 1];
  tryAddGap(
    Math.max(last.end + MEAL_ACTIVITY_GAP, windowRegionStart),
    windowRegionEnd,
    last.location
  );

  return gaps;
}

export function collectMealCandidatesFromPools(
  meal: MealType,
  date: string,
  mealSuggestions: Map<string, PlaceSearchResult>,
  mealPools: Record<MealType, PlaceSearchResult[]>,
  restaurantPool: PlaceSearchResult[]
): MealGapInsertCandidate[] {
  const seen = new Set<string>();
  const out: MealGapInsertCandidate[] = [];

  const add = (result: PlaceSearchResult | undefined) => {
    if (!result || seen.has(result.placeId)) return;
    seen.add(result.placeId);
    out.push({
      placeId: result.placeId,
      name: result.name,
      lat: result.lat,
      lng: result.lng,
      openingHours: result.openingHours ?? null,
    });
  };

  add(mealSuggestions.get(`${date}-${meal}`));
  for (const [key, candidate] of mealSuggestions) {
    if (key.endsWith(`-${meal}`)) add(candidate);
  }
  for (const candidate of mealPools[meal]) add(candidate);
  for (const candidate of restaurantPool) add(candidate);

  return out;
}

function hasReliableOpeningHours(hours?: OpeningHours | null): boolean {
  return Boolean(hours?.periods?.length);
}

/**
 * Try to place a meal in the earliest valid gap within the meal window.
 * Uses saved pool candidates only — no live Google calls.
 */
export async function tryInsertMealViaGaps(params: {
  stops: MealGapStop[];
  meal: MealType;
  date: string;
  hotel: LatLng;
  dayEndMinutes: number;
  candidates: MealGapInsertCandidate[];
  travelTime: TravelTimeFn;
  usedGoogleIds: Set<string>;
  usedMealBrands: Set<string>;
  manualGoogleIds: Set<string>;
  allowDuplicateBrand?: boolean;
  relaxed?: boolean;
}): Promise<MealGapInsertResult> {
  const {
    stops,
    meal,
    date,
    hotel,
    dayEndMinutes,
    candidates,
    travelTime,
    usedGoogleIds,
    usedMealBrands,
    manualGoogleIds,
    allowDuplicateBrand = false,
    relaxed = false,
  } = params;

  const rejections = emptyMealRejectionCounts();
  const slotStops = toMealSlotStops(stops);
  const bounds = mealInsertionBounds(meal, slotStops, date, hotel);
  if (!bounds) {
    return {
      success: false,
      gapsConsidered: 0,
      candidateCount: candidates.length,
      rejections,
      skipReason: "insertion_bounds_unavailable",
    };
  }

  const gaps = findMealWindowGaps(stops, meal, bounds, hotel, dayEndMinutes, date);
  if (gaps.length === 0) {
    return {
      success: false,
      gapsConsidered: 0,
      candidateCount: candidates.length,
      rejections,
      skipReason: "no_gaps_in_window",
    };
  }

  if (candidates.length === 0) {
    rejections.noCandidates = 1;
    return {
      success: false,
      gapsConsidered: gaps.length,
      candidateCount: 0,
      rejections,
      skipReason: "no_candidates",
    };
  }

  const window = MEAL_WINDOWS[meal];
  const lunchStartForBreakfast = effectiveLunchStartForBreakfastBounds(slotStops);
  const lunchEndBoundary = lunchStartForBreakfast - MEAL_ACTIVITY_GAP;
  const notAfter = relaxed ? bounds.notAfter + 60 : bounds.notAfter;

  for (const gap of gaps) {
    for (const candidate of candidates) {
      if (usedGoogleIds.has(candidate.placeId)) {
        rejections.usedGoogleId++;
        continue;
      }
      if (manualGoogleIds.has(candidate.placeId)) {
        rejections.manualPlaceExcluded++;
        continue;
      }
      if (!relaxed && !isSitDownRestaurant(candidate.name)) {
        rejections.invalidMealCandidate++;
        continue;
      }
      if (!allowDuplicateBrand && isRestaurantBrandUsed(candidate.name, usedMealBrands)) {
        rejections.duplicateBrand++;
        continue;
      }

      const travel = await travelTime(gap.locationBefore, {
        lat: candidate.lat,
        lng: candidate.lng,
      });
      const travelArrival = Math.max(gap.regionStart, gap.regionStart + travel);

      let mealStart = resolveMealStartMinutes(date, meal, candidate.openingHours, {
        notBefore: Math.max(bounds.notBefore, travelArrival),
        notAfter,
        lunchStart: lunchStartForBreakfast,
      });

      if (mealStart == null && relaxed && !hasReliableOpeningHours(candidate.openingHours)) {
        mealStart = Math.min(
          Math.max(travelArrival, bounds.notBefore),
          notAfter
        );
      }

      if (mealStart == null) {
        rejections.closedOrHoursFailed++;
        continue;
      }

      if (mealStart > gap.regionEnd - window.duration || mealStart > notAfter) {
        rejections.outsideMealWindow++;
        continue;
      }
      if (mealStart + window.duration > dayEndMinutes) {
        rejections.deadlineOrDayEndFailed++;
        continue;
      }
      if (meal === "breakfast" && mealStart + window.duration > lunchEndBoundary) {
        rejections.outsideMealWindow++;
        continue;
      }

      registerRestaurantBrand(candidate.name, usedMealBrands);
      usedGoogleIds.add(candidate.placeId);

      return {
        success: true,
        mealStart,
        candidate,
        gapsConsidered: gaps.length,
        candidateCount: candidates.length,
        rejections,
      };
    }
  }

  return {
    success: false,
    gapsConsidered: gaps.length,
    candidateCount: candidates.length,
    rejections,
    skipReason: "all_candidates_rejected",
  };
}

export function mealStartToScheduledTime(mealStart: number): string {
  return minutesToTimeString(mealStart);
}
