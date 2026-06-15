import type { LatLng, Place, PlaceSearchResult, TripInterest } from "@/lib/types";
import { isExperienceActivity, isParkOrNaturePlace } from "@/lib/types";
import {
  getDefaultVisitMinutes,
  MEAL_WINDOWS,
  minutesToTimeString,
  resolveVisitArrivalMinutes,
  type OpeningHours,
} from "@/lib/itinerary/hours";
import { parseDayBounds, parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import { compareStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import { placeTheme, themeAllowed } from "@/lib/itinerary/place-theme";
import { getActivityLocations, isExcursionDay } from "@/lib/itinerary/meal-locations";
import {
  candidateMatchesInterest,
  initTripInterestCounts,
  interestsMatchedByCandidate,
  rankActivityInterests,
  registerInterestHits,
} from "@/lib/itinerary/interest-scheduling";
import { googlePlaceIdsForManualPlaces, getManualPlaces } from "@/lib/itinerary/manual-places";
import type { TravelTimeFn } from "@/lib/itinerary/travel";
import { recomputeScheduleTimes } from "@/lib/itinerary/schedule-times";
import {
  type SmartItineraryDay,
  type SmartItineraryDayStop,
  toSuggestedInput,
} from "@/lib/itinerary/smart-generate";
import {
  logDensityRepairAdded,
  logDensityRepairSkipped,
  logDensityRepairStart,
  logDensityRepairSummary,
} from "@/lib/itinerary/generate-diagnostics";

const SIGHTSEEING_CATEGORIES = new Set(["monument", "museum", "activity"]);
const NIGHTLIFE_CATEGORIES = new Set(["bar", "nightlife"]);

/** Caps to prevent infinite loops during in-memory repair. */
export const DENSITY_REPAIR_CAPS = {
  targetSightseeing: 2,
  maxCandidatesPerSlot: 25,
  maxAddedPerDay: 2,
  maxTotalAttempts: 50,
} as const;

type ActivityPoolEntry = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  category?: import("@/lib/types").PlaceCategory;
  photoUrl?: string | null;
  openingHours?: OpeningHours | null;
  types?: string[];
};

export interface DensityRepairSkipCounts {
  usedGoogleId: number;
  duplicateOnDay: number;
  openingHours: number;
  scheduleWindow: number;
  afterDinnerNonNightlife: number;
  themeDuplicate: number;
  notSightseeingCategory: number;
  noCandidates: number;
  excursionDay: number;
  alreadyMetTarget: number;
}

export function emptyDensityRepairSkipCounts(): DensityRepairSkipCounts {
  return {
    usedGoogleId: 0,
    duplicateOnDay: 0,
    openingHours: 0,
    scheduleWindow: 0,
    afterDinnerNonNightlife: 0,
    themeDuplicate: 0,
    notSightseeingCategory: 0,
    noCandidates: 0,
    excursionDay: 0,
    alreadyMetTarget: 0,
  };
}

function countSightseeingStops(stops: SmartItineraryDayStop[]): number {
  return stops.filter((s) => {
    if (s.mealType || s.stopType === "meal") return false;
    const cat = s.place?.category ?? s.suggestedPlace?.category;
    return cat != null && SIGHTSEEING_CATEGORIES.has(cat);
  }).length;
}

function poolEntryFromSearchResult(result: PlaceSearchResult): ActivityPoolEntry {
  const suggested = toSuggestedInput(result);
  return {
    placeId: suggested.placeId,
    name: suggested.name,
    address: suggested.address,
    lat: suggested.lat,
    lng: suggested.lng,
    rating: suggested.rating,
    category: suggested.category,
    photoUrl: suggested.photoUrl,
    openingHours: suggested.openingHours,
    types: result.types,
  };
}

function mergeActivityPools(
  interestPool: PlaceSearchResult[],
  parksPool: PlaceSearchResult[],
  experiencesPool: PlaceSearchResult[]
): ActivityPoolEntry[] {
  const seen = new Set<string>();
  const merged: ActivityPoolEntry[] = [];
  for (const pool of [experiencesPool, parksPool, interestPool]) {
    for (const result of pool) {
      if (seen.has(result.placeId)) continue;
      seen.add(result.placeId);
      merged.push(poolEntryFromSearchResult(result));
    }
  }
  return merged;
}

function orderedRepairCandidates(
  suggestionPool: ActivityPoolEntry[],
  rankedInterests: ReturnType<typeof rankActivityInterests>,
  usedGoogleIds: Set<string>,
  dayGoogleIds: Set<string>,
  dayThemes: Set<string>,
  slotExclude: Set<string>,
  manualGoogleIds: Set<string>
): ActivityPoolEntry[] {
  const seen = new Set<string>();
  const ordered: ActivityPoolEntry[] = [];

  const tryAdd = (entry: ActivityPoolEntry) => {
    if (seen.has(entry.placeId)) return;
    const category = entry.category ?? "activity";
    if (!SIGHTSEEING_CATEGORIES.has(category)) return;
    if (NIGHTLIFE_CATEGORIES.has(category)) return;
    if (manualGoogleIds.has(entry.placeId)) return;
    if (usedGoogleIds.has(entry.placeId)) return;
    if (dayGoogleIds.has(entry.placeId)) return;
    if (slotExclude.has(entry.placeId)) return;
    if (!themeAllowed(dayThemes, entry.name, category)) return;
    seen.add(entry.placeId);
    ordered.push(entry);
  };

  for (const interest of rankedInterests) {
    for (const entry of suggestionPool) {
      if (
        candidateMatchesInterest(
          {
            name: entry.name,
            category: entry.category ?? "activity",
            outdoor: isParkOrNaturePlace(entry.types ?? [], entry.name),
            experience: isExperienceActivity(entry.types ?? [], entry.name),
          },
          interest
        )
      ) {
        tryAdd(entry);
      }
    }
  }

  for (const entry of suggestionPool) {
    tryAdd(entry);
  }

  return ordered;
}

function getDayActivityWindow(
  stops: SmartItineraryDayStop[],
  dayEndMinutes: number
): { start: number; end: number } {
  const breakfast = stops.find((s) => s.mealType === "breakfast");
  const lunch = stops.find((s) => s.mealType === "lunch");

  let start = breakfast?.scheduledTime
    ? parseTimeToMinutes(breakfast.scheduledTime) +
      (breakfast.durationMinutes ?? MEAL_WINDOWS.breakfast.duration) +
      15
    : MEAL_WINDOWS.lunch.start;

  if (lunch?.scheduledTime) {
    start = Math.max(
      start,
      parseTimeToMinutes(lunch.scheduledTime) +
        (lunch.durationMinutes ?? MEAL_WINDOWS.lunch.duration) +
        15
    );
  } else {
    start = Math.max(start, MEAL_WINDOWS.lunch.end);
  }

  const eveningReserved = stops
    .map((s) => s.place?.reservation_time)
    .filter((t): t is string => Boolean(t))
    .map((t) => parseTimeToMinutes(t))
    .filter((t) => t >= MEAL_WINDOWS.lunch.end);

  let end = eveningReserved.length
    ? Math.min(...eveningReserved) - 15
    : MEAL_WINDOWS.dinner.start - 15;
  end = Math.min(end, dayEndMinutes - 30);

  return { start, end: Math.max(end, start + 45) };
}

function getDayGoogleIds(stops: SmartItineraryDayStop[]): Set<string> {
  const ids = new Set<string>();
  for (const stop of stops) {
    const gid = stop.place?.google_place_id ?? stop.suggestedPlace?.placeId;
    if (gid) ids.add(gid);
  }
  return ids;
}

function collectTripUsedGoogleIds(days: SmartItineraryDay[]): Set<string> {
  const ids = new Set<string>();
  for (const day of days) {
    for (const gid of getDayGoogleIds(day.stops)) {
      ids.add(gid);
    }
  }
  return ids;
}

function buildDayThemes(stops: SmartItineraryDayStop[]): Set<string> {
  const themes = new Set<string>();
  for (const stop of stops) {
    if (stop.mealType) {
      themes.add(`meal-${stop.mealType}`);
      continue;
    }
    const name = stop.place?.name ?? stop.suggestedPlace?.name;
    const category = stop.place?.category ?? stop.suggestedPlace?.category;
    if (name && category) {
      themes.add(placeTheme(name, category));
    }
  }
  return themes;
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

async function tryPlaceCandidateAsync(params: {
  candidate: ActivityPoolEntry;
  date: string;
  cursorMinutes: number;
  cursorLocation: LatLng;
  activityWindow: { start: number; end: number };
  travelTime: TravelTimeFn;
  relaxHours: boolean;
}): Promise<{ resolved: number; duration: number } | null> {
  const { candidate, date, cursorMinutes, cursorLocation, activityWindow, travelTime, relaxHours } =
    params;
  const category = candidate.category ?? "activity";
  const outdoor = isParkOrNaturePlace(candidate.types ?? [], candidate.name);
  const experience = isExperienceActivity(candidate.types ?? [], candidate.name);
  const duration = getDefaultVisitMinutes(category);

  const travelMinutes = await travelTime(cursorLocation, {
    lat: candidate.lat,
    lng: candidate.lng,
  });
  const travelStart = cursorMinutes + travelMinutes;
  let resolved: number | null;

  if (relaxHours) {
    resolved = Math.max(travelStart, activityWindow.start);
    if (resolved + duration > activityWindow.end) return null;
  } else {
    resolved = resolveVisitArrivalMinutes(
      date,
      Math.max(travelStart, activityWindow.start),
      category,
      duration,
      candidate.openingHours,
      { outdoor, experience }
    );
    if (resolved == null) return null;
    if (resolved + duration > activityWindow.end) return null;
  }

  if (resolved >= MEAL_WINDOWS.dinner.end && !NIGHTLIFE_CATEGORIES.has(category)) {
    return null;
  }

  return { resolved, duration };
}

export interface DensityRepairInput {
  days: SmartItineraryDay[];
  places: Place[];
  hotel: LatLng;
  interests: TripInterest[];
  travelTime: TravelTimeFn;
  dayStartTime?: string;
  dayEndTime?: string;
  interestPool: PlaceSearchResult[];
  parksPool: PlaceSearchResult[];
  experiencesPool: PlaceSearchResult[];
}

export interface DensityRepairSummary {
  daysConsidered: number;
  daysRepaired: number;
  totalAdded: number;
  totalCandidatesConsidered: number;
  totalAttempts: number;
  skipCounts: DensityRepairSkipCounts;
}

export async function repairItineraryDensity(
  input: DensityRepairInput
): Promise<{ days: SmartItineraryDay[]; summary: DensityRepairSummary }> {
  const {
    days,
    places,
    hotel,
    interests,
    travelTime,
    dayStartTime,
    dayEndTime,
    interestPool,
    parksPool,
    experiencesPool,
  } = input;

  const { dayStartMinutes, dayEndMinutes } = parseDayBounds(dayStartTime, dayEndTime, {
    start: "08:00:00",
    end: "22:00:00",
  });

  const activityPool = mergeActivityPools(interestPool, parksPool, experiencesPool);
  const manualGoogleIds = googlePlaceIdsForManualPlaces(getManualPlaces(places));
  const usedGoogleIds = collectTripUsedGoogleIds(days);
  const tripInterestCounts = initTripInterestCounts(interests);

  const reservedByDate = new Map<string, Place[]>();
  for (const place of places) {
    if (!place.reservation_date) continue;
    const bucket = reservedByDate.get(place.reservation_date) ?? [];
    bucket.push(place);
    reservedByDate.set(place.reservation_date, bucket);
  }

  const summary: DensityRepairSummary = {
    daysConsidered: 0,
    daysRepaired: 0,
    totalAdded: 0,
    totalCandidatesConsidered: 0,
    totalAttempts: 0,
    skipCounts: emptyDensityRepairSkipCounts(),
  };

  const repairedDays: SmartItineraryDay[] = [];

  for (const day of days) {
    const startingSightseeing = countSightseeingStops(day.stops);
    const targetSightseeing = DENSITY_REPAIR_CAPS.targetSightseeing;

    if (startingSightseeing >= targetSightseeing) {
      summary.skipCounts.alreadyMetTarget++;
      repairedDays.push(day);
      continue;
    }

    summary.daysConsidered++;

    const activityLocs = getActivityLocations(day.stops);
    if (isExcursionDay(hotel, activityLocs)) {
      summary.skipCounts.excursionDay++;
      logDensityRepairSkipped({
        dayNumber: day.dayNumber,
        date: day.date,
        reason: "excursion_day",
        startingSightseeing,
        targetSightseeing,
      });
      repairedDays.push(day);
      continue;
    }

    logDensityRepairStart({
      dayNumber: day.dayNumber,
      date: day.date,
      startingSightseeing,
      targetSightseeing,
      poolSize: activityPool.length,
    });

    const reservedToday = reservedByDate.get(day.date) ?? [];
    const dayThemes = buildDayThemes(day.stops);
    const dayInterests = new Set<TripInterest>();
    const activityWindow = getDayActivityWindow(day.stops, dayEndMinutes);
    const activityDeadline = activityWindow.end;

    let cursorMinutes = activityWindow.start;
    const lunchStop = day.stops.find((s) => s.mealType === "lunch");
    const anchorStop =
      lunchStop ??
      day.stops.find((s) => s.mealType === "breakfast") ??
      [...day.stops].reverse().find((s) => s.place ?? s.suggestedPlace);
    let cursorLocation: LatLng = hotel;
    const anchorPlace = anchorStop?.place ?? anchorStop?.suggestedPlace;
    if (anchorPlace) {
      cursorLocation = { lat: anchorPlace.lat, lng: anchorPlace.lng };
    }

    let sightseeingCount = startingSightseeing;
    let addedThisDay = 0;
    let candidatesConsidered = 0;
    const daySkipCounts = emptyDensityRepairSkipCounts();

    while (
      sightseeingCount < targetSightseeing &&
      addedThisDay < DENSITY_REPAIR_CAPS.maxAddedPerDay &&
      summary.totalAttempts < DENSITY_REPAIR_CAPS.maxTotalAttempts &&
      cursorMinutes + 45 < activityDeadline
    ) {
      summary.totalAttempts++;
      const rankedInterests = rankActivityInterests(
        interests,
        dayInterests,
        tripInterestCounts,
        addedThisDay
      );
      const dayGoogleIds = getDayGoogleIds(day.stops);
      const slotExclude = new Set<string>();
      const candidates = orderedRepairCandidates(
        activityPool,
        rankedInterests,
        usedGoogleIds,
        dayGoogleIds,
        dayThemes,
        slotExclude,
        manualGoogleIds
      );

      if (candidates.length === 0) {
        daySkipCounts.noCandidates++;
        break;
      }

      let placed = false;
      let tried = 0;

      for (const candidate of candidates) {
        if (tried >= DENSITY_REPAIR_CAPS.maxCandidatesPerSlot) break;
        tried++;
        candidatesConsidered++;
        summary.totalCandidatesConsidered++;

        const category = candidate.category ?? "activity";
        if (!SIGHTSEEING_CATEGORIES.has(category)) {
          daySkipCounts.notSightseeingCategory++;
          continue;
        }
        if (usedGoogleIds.has(candidate.placeId)) {
          daySkipCounts.usedGoogleId++;
          continue;
        }
        if (dayGoogleIds.has(candidate.placeId)) {
          daySkipCounts.duplicateOnDay++;
          continue;
        }

        let placement = await tryPlaceCandidateAsync({
          candidate,
          date: day.date,
          cursorMinutes,
          cursorLocation,
          activityWindow,
          travelTime,
          relaxHours: false,
        });

        if (!placement) {
          placement = await tryPlaceCandidateAsync({
            candidate,
            date: day.date,
            cursorMinutes,
            cursorLocation,
            activityWindow,
            travelTime,
            relaxHours: true,
          });
          if (!placement) {
            daySkipCounts.openingHours++;
            daySkipCounts.scheduleWindow++;
            slotExclude.add(candidate.placeId);
            continue;
          }
        }

        if (
          placement.resolved >= MEAL_WINDOWS.dinner.end &&
          !NIGHTLIFE_CATEGORIES.has(category)
        ) {
          daySkipCounts.afterDinnerNonNightlife++;
          slotExclude.add(candidate.placeId);
          continue;
        }

        const newStop: SmartItineraryDayStop = {
          stopType: "place",
          suggestedPlace: toSuggestedInput({
            placeId: candidate.placeId,
            name: candidate.name,
            address: candidate.address,
            lat: candidate.lat,
            lng: candidate.lng,
            rating: candidate.rating,
            category: candidate.category ?? "activity",
            photoUrl: candidate.photoUrl ?? undefined,
            openingHours: candidate.openingHours,
            types: candidate.types,
          }),
          durationMinutes: placement.duration,
          scheduledTime: minutesToTimeString(placement.resolved),
          suggestionKey: `${day.date}-density-repair-${addedThisDay}`,
          isSuggested: true,
        };

        day.stops.push(newStop);
        usedGoogleIds.add(candidate.placeId);
        dayThemes.add(placeTheme(candidate.name, category));
        const interestHits = interestsMatchedByCandidate({
          name: candidate.name,
          category,
          outdoor: isParkOrNaturePlace(candidate.types ?? [], candidate.name),
          experience: isExperienceActivity(candidate.types ?? [], candidate.name),
        }).filter((interest) => interests.includes(interest));
        registerInterestHits(tripInterestCounts, dayInterests, interestHits);

        cursorMinutes = placement.resolved + placement.duration;
        cursorLocation = { lat: candidate.lat, lng: candidate.lng };
        addedThisDay++;
        summary.totalAdded++;
        if (SIGHTSEEING_CATEGORIES.has(category)) {
          sightseeingCount++;
        }
        placed = true;

        logDensityRepairAdded({
          dayNumber: day.dayNumber,
          date: day.date,
          placeId: candidate.placeId,
          name: candidate.name,
          category,
          scheduledTime: newStop.scheduledTime,
          sightseeingCount,
        });
        break;
      }

      if (!placed) break;
    }

    if (addedThisDay > 0) {
      summary.daysRepaired++;
      day.stops = recomputeDaySchedule(
        day.stops,
        hotel,
        dayStartMinutes,
        day.date,
        reservedToday
      );
    }

    for (const key of Object.keys(daySkipCounts) as (keyof DensityRepairSkipCounts)[]) {
      summary.skipCounts[key] += daySkipCounts[key];
    }

    logDensityRepairSummary({
      dayNumber: day.dayNumber,
      date: day.date,
      startingSightseeing,
      targetSightseeing,
      finalSightseeing: countSightseeingStops(day.stops),
      candidatesConsidered,
      addedCount: addedThisDay,
      skippedReasons: { ...daySkipCounts },
    });

    repairedDays.push(day);
  }

  logDensityRepairSummary({
    tripLevel: true,
    daysConsidered: summary.daysConsidered,
    daysRepaired: summary.daysRepaired,
    totalAdded: summary.totalAdded,
    totalCandidatesConsidered: summary.totalCandidatesConsidered,
    totalAttempts: summary.totalAttempts,
    skippedReasons: { ...summary.skipCounts },
  });

  return { days: repairedDays, summary };
}
