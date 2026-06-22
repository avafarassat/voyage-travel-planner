import type { LatLng, Place, PlaceSearchResult, TripInterest } from "@/lib/types";
import { isMealAppropriateTime } from "@/lib/itinerary/hours";
import type { MealType } from "@/lib/itinerary/hours";
import { MEAL_WINDOWS, minutesToTimeString } from "@/lib/itinerary/hours";
import { getActivityLocations, isExcursionDay, dayMissingMeals } from "@/lib/itinerary/meal-locations";
import { presentMealSlots, type MealSlotStop } from "@/lib/itinerary/meal-slots";
import { parseDayBounds, parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import { compareStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import { googlePlaceIdsForManualPlaces, getManualPlaces } from "@/lib/itinerary/manual-places";
import { registerRestaurantBrand } from "@/lib/itinerary/meal-dedup";
import { recomputeScheduleTimes } from "@/lib/itinerary/schedule-times";
import type { TravelTimeFn } from "@/lib/itinerary/travel";
import {
  collectMealCandidatesFromPools,
  findMealWindowGaps,
  tryInsertMealViaGaps,
  type MealGapStop,
} from "@/lib/itinerary/meal-gap-insert";
import {
  logMealWindowRepairAdded,
  logMealWindowRepairSkipped,
  logMealWindowRepairStart,
  logMealWindowRepairSummary,
} from "@/lib/itinerary/generate-diagnostics";
import {
  type SmartItineraryDay,
  type SmartItineraryDayStop,
  toSuggestedInput,
} from "@/lib/itinerary/smart-generate";

export const MEAL_WINDOW_REPAIR_CAPS = {
  maxCandidatesPerMeal: 25,
  maxMealsAddedPerDay: 3,
  maxTotalAttempts: 50,
} as const;

export interface MealWindowRepairSkipCounts {
  alreadyComplete: number;
  excursionDay: number;
  reservedMeal: number;
  noBounds: number;
  noGaps: number;
  noCandidates: number;
  allRejected: number;
}

export function emptyMealWindowRepairSkipCounts(): MealWindowRepairSkipCounts {
  return {
    alreadyComplete: 0,
    excursionDay: 0,
    reservedMeal: 0,
    noBounds: 0,
    noGaps: 0,
    noCandidates: 0,
    allRejected: 0,
  };
}

export interface MealWindowRepairInput {
  days: SmartItineraryDay[];
  places: Place[];
  hotel: LatLng;
  travelTime: TravelTimeFn;
  dayStartTime?: string;
  dayEndTime?: string;
  mealSuggestions: Map<string, PlaceSearchResult>;
  mealPools: Record<MealType, PlaceSearchResult[]>;
  restaurantPool: PlaceSearchResult[];
}

export interface MealWindowRepairSummary {
  daysConsidered: number;
  daysRepaired: number;
  totalAdded: number;
  totalGapsConsidered: number;
  totalAttempts: number;
  skipCounts: MealWindowRepairSkipCounts;
}

function parseReservationMinutes(time: string): number {
  return parseTimeToMinutes(time.slice(0, 8));
}

function detectReservedMeals(reservedToday: Place[]): Set<MealType> {
  const meals = new Set<MealType>();
  for (const place of reservedToday) {
    if (place.category !== "restaurant" || !place.reservation_time) continue;
    const mins = parseReservationMinutes(place.reservation_time);
    if (isMealAppropriateTime("breakfast", mins)) meals.add("breakfast");
    if (isMealAppropriateTime("lunch", mins)) meals.add("lunch");
    if (isMealAppropriateTime("dinner", mins)) meals.add("dinner");
  }
  return meals;
}

function toGapStops(stops: SmartItineraryDayStop[]): MealGapStop[] {
  return stops.map((s) => ({
    stopType: s.stopType,
    mealType: s.mealType ?? null,
    scheduledTime: s.scheduledTime,
    durationMinutes: s.durationMinutes,
    placeId: s.placeId,
    place: s.place
      ? {
          lat: s.place.lat,
          lng: s.place.lng,
          category: s.place.category,
          reservation_time: s.place.reservation_time,
          reservation_date: s.place.reservation_date,
          source: s.place.source,
          name: s.place.name,
        }
      : null,
    suggestedPlace: s.suggestedPlace
      ? {
          lat: s.suggestedPlace.lat,
          lng: s.suggestedPlace.lng,
          category: s.suggestedPlace.category,
          name: s.suggestedPlace.name,
          openingHours: s.suggestedPlace.openingHours,
        }
      : null,
  }));
}

function toRhythmShape(
  stop: SmartItineraryDayStop,
  reservedToday: Place[],
  date: string
) {
  const reservedPlace = stop.placeId
    ? reservedToday.find((p) => p.id === stop.placeId)
    : stop.place;
  const place = stop.place ?? stop.suggestedPlace;
  return {
    stop_type: stop.stopType,
    meal_type: stop.mealType ?? null,
    scheduled_time: stop.scheduledTime,
    place: place
      ? {
          category: place.category,
          reservation_time: reservedPlace?.reservation_time ?? null,
        }
      : null,
    anchor_time:
      reservedPlace?.reservation_time && reservedPlace.reservation_date === date
        ? reservedPlace.reservation_time
        : null,
  };
}

function recomputeDaySchedule(
  stops: SmartItineraryDayStop[],
  hotel: LatLng,
  dayStartMinutes: number,
  date: string,
  reservedToday: Place[]
): SmartItineraryDayStop[] {
  const rhythmSorted = [...stops].sort((a, b) =>
    compareStopsByDayRhythm(
      toRhythmShape(a, reservedToday, date),
      toRhythmShape(b, reservedToday, date)
    )
  );

  const scheduleStops = rhythmSorted.map((stop) => {
    const reservedPlace = stop.placeId
      ? reservedToday.find((p) => p.id === stop.placeId)
      : stop.place;
    const anchorTime =
      reservedPlace?.reservation_time && reservedPlace.reservation_date === date
        ? reservedPlace.reservation_time
        : null;
    return {
      stop_type: stop.stopType,
      meal_type: stop.mealType ?? null,
      duration_minutes: stop.durationMinutes,
      scheduled_time: stop.scheduledTime,
      place: stop.place
        ? {
            lat: stop.place.lat,
            lng: stop.place.lng,
            category: stop.place.category,
            name: stop.place.name,
          }
        : stop.suggestedPlace
          ? {
              lat: stop.suggestedPlace.lat,
              lng: stop.suggestedPlace.lng,
              category: stop.suggestedPlace.category,
              name: stop.suggestedPlace.name,
            }
          : null,
      opening_hours: stop.place?.opening_hours ?? stop.suggestedPlace?.openingHours ?? null,
      anchor_time: anchorTime,
    };
  });

  const times = recomputeScheduleTimes(scheduleStops, hotel, dayStartMinutes, date);
  return rhythmSorted.map((stop, i) => {
    const anchor = scheduleStops[i].anchor_time;
    return {
      ...stop,
      scheduledTime: anchor
        ? anchor.slice(0, 8).length === 5
          ? `${anchor.slice(0, 5)}:00`
          : anchor.slice(0, 8)
        : times[i].scheduled_time,
    };
  });
}

function mealCheckFromDay(stops: SmartItineraryDayStop[]): MealSlotStop[] {
  return stops.map((s) => ({
    meal_type: s.mealType ?? null,
    stop_type: s.stopType,
    scheduled_time: s.scheduledTime,
    duration_minutes: s.durationMinutes,
    place: s.place
      ? {
          category: s.place.category,
          reservation_time: s.place.reservation_time,
          source: s.place.source,
        }
      : s.suggestedPlace
        ? { category: s.suggestedPlace.category }
        : null,
  }));
}

function collectTripUsedGoogleIds(days: SmartItineraryDay[]): Set<string> {
  const ids = new Set<string>();
  for (const day of days) {
    for (const stop of day.stops) {
      const gid = stop.place?.google_place_id ?? stop.suggestedPlace?.placeId;
      if (gid) ids.add(gid);
    }
  }
  return ids;
}

function buildMealStop(
  meal: MealType,
  candidate: PlaceSearchResult,
  mealStart: number
): SmartItineraryDayStop {
  const suggested = toSuggestedInput(candidate);
  return {
    stopType: "meal",
    suggestedPlace: suggested,
    mealType: meal,
    durationMinutes: MEAL_WINDOWS[meal].duration,
    scheduledTime: minutesToTimeString(mealStart),
    suggestionKey: `meal-repair-${meal}`,
    isSuggested: true,
  };
}

/**
 * Pre–quality-gate repair: insert missing B/L/D into open gaps within meal windows.
 * Uses saved pool candidates only — no Google calls, no retries.
 */
export async function repairItineraryMeals(
  input: MealWindowRepairInput
): Promise<{ days: SmartItineraryDay[]; summary: MealWindowRepairSummary }> {
  const {
    days,
    places,
    hotel,
    travelTime,
    dayStartTime,
    dayEndTime,
    mealSuggestions,
    mealPools,
    restaurantPool,
  } = input;

  const { dayStartMinutes, dayEndMinutes } = parseDayBounds(dayStartTime, dayEndTime, {
    start: "08:00:00",
    end: "22:00:00",
  });

  const manualGoogleIds = googlePlaceIdsForManualPlaces(getManualPlaces(places));
  const usedGoogleIds = collectTripUsedGoogleIds(days);
  const usedMealBrands = new Set<string>();
  for (const place of places) {
    if (place.category === "restaurant" && place.name) {
      registerRestaurantBrand(place.name, usedMealBrands);
    }
  }

  const reservedByDate = new Map<string, Place[]>();
  for (const place of places) {
    if (!place.reservation_date) continue;
    const bucket = reservedByDate.get(place.reservation_date) ?? [];
    bucket.push(place);
    reservedByDate.set(place.reservation_date, bucket);
  }

  const summary: MealWindowRepairSummary = {
    daysConsidered: 0,
    daysRepaired: 0,
    totalAdded: 0,
    totalGapsConsidered: 0,
    totalAttempts: 0,
    skipCounts: emptyMealWindowRepairSkipCounts(),
  };

  const repairedDays: SmartItineraryDay[] = [];

  for (const day of days) {
    const reservedToday = reservedByDate.get(day.date) ?? [];
    const reservedMeals = detectReservedMeals(reservedToday);
    const missing = dayMissingMeals(mealCheckFromDay(day.stops), reservedMeals);

    if (missing.length === 0) {
      summary.skipCounts.alreadyComplete++;
      repairedDays.push(day);
      continue;
    }

    const activityLocs = getActivityLocations(day.stops);
    if (isExcursionDay(hotel, activityLocs)) {
      summary.skipCounts.excursionDay++;
      logMealWindowRepairSkipped({
        dayNumber: day.dayNumber,
        date: day.date,
        reason: "excursion_day",
        missingMeals: missing,
      });
      repairedDays.push(day);
      continue;
    }

    summary.daysConsidered++;
    let workingStops = [...day.stops];
    let addedThisDay = 0;
    let dayRepaired = false;

    for (const meal of missing) {
      if (summary.totalAttempts >= MEAL_WINDOW_REPAIR_CAPS.maxTotalAttempts) break;
      if (addedThisDay >= MEAL_WINDOW_REPAIR_CAPS.maxMealsAddedPerDay) break;
      if (reservedMeals.has(meal)) {
        summary.skipCounts.reservedMeal++;
        continue;
      }
      if (presentMealSlots(mealCheckFromDay(workingStops)).has(meal)) continue;

      summary.totalAttempts++;

      const gapStops = toGapStops(workingStops);
      const allCandidates = collectMealCandidatesFromPools(
        meal,
        day.date,
        mealSuggestions,
        mealPools,
        restaurantPool
      ).slice(0, MEAL_WINDOW_REPAIR_CAPS.maxCandidatesPerMeal);

      logMealWindowRepairStart({
        dayNumber: day.dayNumber,
        date: day.date,
        meal,
        candidateCount: allCandidates.length,
        originalFailureReason: "cursor_past_window_or_schedule_gap",
      });

      const result = await tryInsertMealViaGaps({
        stops: gapStops,
        meal,
        date: day.date,
        hotel,
        dayEndMinutes,
        candidates: allCandidates,
        travelTime,
        usedGoogleIds,
        usedMealBrands,
        manualGoogleIds,
        allowDuplicateBrand: false,
        relaxed: true,
      });

      summary.totalGapsConsidered += result.gapsConsidered;

      if (!result.success || result.mealStart == null || !result.candidate) {
        const reason = result.skipReason ?? "all_candidates_rejected";
        if (reason === "insertion_bounds_unavailable") summary.skipCounts.noBounds++;
        else if (reason === "no_gaps_in_window") summary.skipCounts.noGaps++;
        else if (reason === "no_candidates") summary.skipCounts.noCandidates++;
        else summary.skipCounts.allRejected++;

        logMealWindowRepairSkipped({
          dayNumber: day.dayNumber,
          date: day.date,
          reason,
          missingMeals: [meal],
          gapsConsidered: result.gapsConsidered,
          candidateCount: result.candidateCount,
        });
        continue;
      }

      const searchResult: PlaceSearchResult =
        mealPools[meal].find((c) => c.placeId === result.candidate!.placeId) ??
        restaurantPool.find((c) => c.placeId === result.candidate!.placeId) ??
        mealSuggestions.get(`${day.date}-${meal}`) ??
        {
          placeId: result.candidate.placeId,
          name: result.candidate.name,
          address: "",
          lat: result.candidate.lat,
          lng: result.candidate.lng,
          openingHours: result.candidate.openingHours ?? undefined,
          category: "restaurant",
          types: [],
        };

      workingStops.push(buildMealStop(meal, searchResult, result.mealStart));
      workingStops = recomputeDaySchedule(
        workingStops,
        hotel,
        dayStartMinutes,
        day.date,
        reservedToday
      );
      addedThisDay++;
      dayRepaired = true;
      summary.totalAdded++;

      logMealWindowRepairAdded({
        dayNumber: day.dayNumber,
        date: day.date,
        meal,
        placeId: result.candidate.placeId,
        name: result.candidate.name,
        scheduledTime: minutesToTimeString(result.mealStart),
        gapsConsidered: result.gapsConsidered,
        candidateCount: result.candidateCount,
      });
    }

    if (dayRepaired) summary.daysRepaired++;

    logMealWindowRepairSummary({
      dayNumber: day.dayNumber,
      date: day.date,
      missingMealsBefore: missing,
      addedCount: addedThisDay,
      finalMissing: dayMissingMeals(mealCheckFromDay(workingStops), reservedMeals),
        skippedReasons: { ...summary.skipCounts },
    });

    repairedDays.push({
      ...day,
      stops: [...workingStops].sort((a, b) =>
        compareStopsByDayRhythm(
          toRhythmShape(a, reservedToday, day.date),
          toRhythmShape(b, reservedToday, day.date)
        )
      ),
    });
  }

  logMealWindowRepairSummary({
    tripLevel: true,
    daysConsidered: summary.daysConsidered,
    daysRepaired: summary.daysRepaired,
    totalAdded: summary.totalAdded,
    totalGapsConsidered: summary.totalGapsConsidered,
    totalAttempts: summary.totalAttempts,
    skippedReasons: { ...summary.skipCounts },
  });

  return { days: repairedDays, summary };
}

// Re-export gap helpers for smart-generate addMeal integration
export { findMealWindowGaps, tryInsertMealViaGaps, collectMealCandidatesFromPools };
