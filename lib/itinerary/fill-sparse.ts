import type { SupabaseClient } from "@supabase/supabase-js";
import { createEstimateTravelTimeFn } from "@/lib/itinerary/travel";
import {
  fetchAlternativeSuggestion,
  fetchExperiencesPool,
  fetchMealSuggestionCandidates,
  fetchParksAndNaturePool,
  fetchTopSuggestions,
} from "@/lib/itinerary/google-places";
import { rescheduleItineraryDay } from "@/lib/itinerary/apply-reschedule";
import { getDefaultVisitMinutes, MEAL_WINDOWS, minutesToTimeString, resolveMealArrivalMinutes, resolveVisitArrivalMinutes, type OpeningHours } from "@/lib/itinerary/hours";
import { parseDayBounds, parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import { compareStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import { placeTheme, themeAllowed } from "@/lib/itinerary/place-theme";
import {
  dayMissingMeals,
  getActivityLocations,
  getMealSearchLocation,
  isExcursionDay,
} from "@/lib/itinerary/meal-locations";
import type { Place, TripInterest } from "@/lib/types";
import { isExperienceActivity, isParkOrNaturePlace } from "@/lib/types";
import {
  candidateMatchesInterest,
  initTripInterestCounts,
  interestsMatchedByCandidate,
  rankActivityInterests,
  registerInterestHits,
} from "@/lib/itinerary/interest-scheduling";
import {
  getGooglePlaceIdsOnDay,
  isPlaceAlreadyOnDay,
} from "@/lib/itinerary/day-place-usage";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import {
  isRestaurantBrandUsed,
  registerRestaurantBrand,
} from "@/lib/itinerary/meal-dedup";
import {
  earliestMealStart,
  mealInsertionBounds,
  MEAL_ACTIVITY_GAP,
  presentMealSlots,
  resolveMealStartMinutes,
  type MealSlotStop,
} from "@/lib/itinerary/meal-slots";
import {
  emptyMealRejectionCounts,
  logMealNotPlaced,
} from "@/lib/itinerary/generate-diagnostics";

type StopRow = {
  id: string;
  itinerary_day_id: string;
  sort_order: number;
  stop_type: string;
  meal_type: string | null;
  scheduled_time: string | null;
  duration_minutes: number | null;
  is_suggested: boolean;
  is_completed: boolean;
  place_id: string | null;
  place?: Place | Place[] | null;
};

function normalizePlace(stop: StopRow): Place | null {
  if (!stop.place) return null;
  return Array.isArray(stop.place) ? stop.place[0] : stop.place;
}

function normalizeStopPlace(stop: StopRow) {
  const place = normalizePlace(stop);
  return {
    is_completed: stop.is_completed ?? false,
    place_id: stop.place_id,
    place,
  };
}

const SIGHTSEEING_CATEGORIES = new Set(["monument", "museum", "activity"]);

type FillSparsePoolEntry = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  category?: import("@/lib/types").PlaceCategory;
  photoUrl?: string;
  openingHours?: OpeningHours | null;
  types?: string[];
};

/** Rank fill-sparse activity candidates without mutating used sets. */
function orderedFillSparseCandidates(
  suggestionPool: FillSparsePoolEntry[],
  rankedInterests: ReturnType<typeof rankActivityInterests>,
  usedGoogleIds: Set<string>,
  dayGoogleIds: Set<string>,
  dayThemes: Set<string>,
  slotExclude: Set<string>
): FillSparsePoolEntry[] {
  const seen = new Set<string>();
  const ordered: FillSparsePoolEntry[] = [];

  const tryAdd = (entry: FillSparsePoolEntry) => {
    if (seen.has(entry.placeId)) return;
    if (usedGoogleIds.has(entry.placeId)) return;
    if (dayGoogleIds.has(entry.placeId)) return;
    if (slotExclude.has(entry.placeId)) return;
    if (!themeAllowed(dayThemes, entry.name, entry.category ?? "activity")) return;
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

function countSightseeingStops(stops: StopRow[]): number {
  return stops.filter((s) => {
    if (s.meal_type) return false;
    const p = normalizePlace(s);
    return p?.category != null && SIGHTSEEING_CATEGORIES.has(p.category);
  }).length;
}

function hasSightseeingBetweenBreakfastAndLunch(stops: StopRow[]): boolean {
  const sorted = [...stops].sort((a, b) =>
    compareStopsByDayRhythm(
      {
        stop_type: a.stop_type,
        meal_type: a.meal_type,
        scheduled_time: a.scheduled_time,
        place: normalizePlace(a),
      },
      {
        stop_type: b.stop_type,
        meal_type: b.meal_type,
        scheduled_time: b.scheduled_time,
        place: normalizePlace(b),
      }
    )
  );
  const breakfastIdx = sorted.findIndex((s) => s.meal_type === "breakfast");
  const lunchIdx = sorted.findIndex((s) => s.meal_type === "lunch");
  if (breakfastIdx < 0 || lunchIdx < 0 || lunchIdx <= breakfastIdx + 1) {
    return breakfastIdx < 0 || lunchIdx < 0;
  }
  return sorted.slice(breakfastIdx + 1, lunchIdx).some((s) => {
    const p = normalizePlace(s);
    return p?.category != null && SIGHTSEEING_CATEGORIES.has(p.category);
  });
}

function dayIsSparse(stops: StopRow[], options?: { excursionDay?: boolean }): boolean {
  const minStops = options?.excursionDay ? 4 : 5;
  if (stops.length < minStops) return true;
  if (countSightseeingStops(stops) < 2) return true;
  if (!hasSightseeingBetweenBreakfastAndLunch(stops)) return true;
  const hasBreakfast = stops.some((s) => s.meal_type === "breakfast");
  const hasLunch = stops.some((s) => s.meal_type === "lunch");
  const hasDinner = stops.some((s) => s.meal_type === "dinner");
  if (!hasBreakfast || !hasLunch || !hasDinner) return true;
  const first = stops.find((s) => s.scheduled_time);
  if (first?.scheduled_time && parseTimeToMinutes(first.scheduled_time) > MEAL_WINDOWS.breakfast.end) {
    return true;
  }
  const last = stops[stops.length - 1];
  if (!last?.scheduled_time) return true;
  const lastEnd =
    parseTimeToMinutes(last.scheduled_time) + (last.duration_minutes ?? 60);
  return lastEnd < MEAL_WINDOWS.dinner.start + 60;
}

function stopsForMealCheck(stops: StopRow[]) {
  return stops.map((s) => {
    const place = normalizePlace(s);
    return {
      meal_type: s.meal_type,
      stop_type: s.stop_type,
      scheduled_time: s.scheduled_time,
      place: place
        ? {
            category: place.category,
            reservation_time: place.reservation_time,
          }
        : null,
    };
  });
}

function dayNeedsFill(stops: StopRow[], options?: { excursionDay?: boolean }): boolean {
  if (dayMissingMeals(stopsForMealCheck(stops)).length > 0) return true;
  return dayIsSparse(stops, options);
}

function getDayActivityWindow(
  sortedStops: StopRow[],
  dayEndMinutes: number
): { start: number; end: number } {
  const breakfast = sortedStops.find((s) => s.meal_type === "breakfast");
  const lunch = sortedStops.find((s) => s.meal_type === "lunch");

  let start = breakfast?.scheduled_time
    ? parseTimeToMinutes(breakfast.scheduled_time) +
      (breakfast.duration_minutes ?? MEAL_WINDOWS.breakfast.duration) +
      15
    : MEAL_WINDOWS.lunch.start;

  if (lunch?.scheduled_time) {
    start = Math.max(
      start,
      parseTimeToMinutes(lunch.scheduled_time) +
        (lunch.duration_minutes ?? MEAL_WINDOWS.lunch.duration) +
        15
    );
  } else {
    start = Math.max(start, MEAL_WINDOWS.lunch.end);
  }

  const eveningReserved = sortedStops
    .map((s) => normalizePlace(s))
    .filter((p) => p?.reservation_time)
    .map((p) => parseTimeToMinutes(p!.reservation_time!))
    .filter((t) => t >= MEAL_WINDOWS.lunch.end);

  let end = eveningReserved.length
    ? Math.min(...eveningReserved) - 15
    : MEAL_WINDOWS.dinner.start - 15;
  end = Math.min(end, dayEndMinutes - 30);

  return { start, end: Math.max(end, start + 45) };
}

async function resolveMealPlace(
  supabase: SupabaseClient,
  tripId: string,
  meal: "breakfast" | "lunch" | "dinner",
  location: { lat: number; lng: number },
  city: string,
  usedGoogleIds: Set<string>,
  usedMealBrands: Set<string>,
  apiKey: string,
  placement: {
    date: string;
    bounds: { notBefore: number; notAfter: number };
    lunchStart: number | null;
    workingStops: () => MealSlotStop[];
  },
  options?: { relaxed?: boolean }
): Promise<{
  placeId: string;
  googlePlaceId: string;
  openingHours?: OpeningHours | null;
  mealStart: number;
} | null> {
  const relaxed = options?.relaxed ?? false;
  const window = MEAL_WINDOWS[meal];
  const primary = await fetchMealSuggestionCandidates(
    location.lat,
    location.lng,
    city,
    meal,
    [...usedGoogleIds],
    apiKey,
    relaxed ? [] : [...usedMealBrands]
  );
  const seen = new Set(primary.map((c) => c.placeId));
  const candidates = [...primary];

  const alt = await fetchAlternativeSuggestion(
    location.lat,
    location.lng,
    city,
    "restaurant",
    [...usedGoogleIds, ...seen],
    apiKey,
    relaxed ? [] : [...usedMealBrands]
  );
  if (alt && !seen.has(alt.placeId)) {
    candidates.push(alt);
  }

  const lunchEndBoundary =
    (placement.lunchStart ?? MEAL_WINDOWS.lunch.start) - MEAL_ACTIVITY_GAP;
  const rejections = emptyMealRejectionCounts();
  const notAfter = relaxed ? placement.bounds.notAfter + 60 : placement.bounds.notAfter;

  if (candidates.length === 0) {
    rejections.noCandidates = 1;
  }

  for (const candidate of candidates) {
    if (!relaxed && isRestaurantBrandUsed(candidate.name, usedMealBrands)) {
      rejections.duplicateBrand++;
      continue;
    }

    let mealStart: number | null;
    if (meal === "breakfast") {
      mealStart = resolveMealStartMinutes(
        placement.date,
        meal,
        candidate.openingHours,
        {
          notBefore: placement.bounds.notBefore,
          notAfter,
          lunchStart: placement.lunchStart,
        }
      );
    } else {
      mealStart = resolveMealArrivalMinutes(
        placement.date,
        placement.bounds.notBefore,
        null,
        meal,
        window.duration,
        candidate.openingHours,
        {
          latestStart: notAfter,
          notBefore: placement.bounds.notBefore,
        }
      );
    }
    if (mealStart == null) {
      rejections.closedOrHoursFailed++;
      continue;
    }
    if (meal === "breakfast" && mealStart + window.duration > lunchEndBoundary) {
      rejections.outsideMealWindow++;
      continue;
    }

    const persisted = await persistMealCandidate(
      supabase,
      tripId,
      candidate,
      usedGoogleIds
    );
    if (!persisted) continue;
    registerRestaurantBrand(candidate.name, usedMealBrands);
    return {
      ...persisted,
      openingHours: candidate.openingHours ?? null,
      mealStart,
    };
  }

  if (!relaxed && candidates.length > 0) {
    logMealNotPlaced({
      phase: "fillSparseDays",
      date: placement.date,
      meal,
      candidateCount: candidates.length,
      rejections,
    });
  }

  return null;
}

async function persistMealCandidate(
  supabase: SupabaseClient,
  tripId: string,
  candidate: {
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    rating?: number;
    photoUrl?: string;
    openingHours?: OpeningHours | null;
  },
  usedGoogleIds: Set<string>
): Promise<{ placeId: string; googlePlaceId: string } | null> {
  const { data: existing } = await supabase
    .from("places")
    .select("id")
    .eq("trip_id", tripId)
    .eq("google_place_id", candidate.placeId)
    .maybeSingle();

  if (existing) {
    if (candidate.openingHours) {
      await supabase
        .from("places")
        .update({ opening_hours: candidate.openingHours })
        .eq("id", existing.id);
    }
    usedGoogleIds.add(candidate.placeId);
    return { placeId: existing.id, googlePlaceId: candidate.placeId };
  }

  const { data: newPlace } = await supabase
    .from("places")
    .insert({
      trip_id: tripId,
      name: candidate.name,
      category: "restaurant",
      address: candidate.address,
      lat: candidate.lat,
      lng: candidate.lng,
      source: "suggested",
      google_place_id: candidate.placeId,
      rating: candidate.rating ?? null,
      photo_url: candidate.photoUrl ?? null,
      opening_hours: candidate.openingHours ?? null,
    })
    .select("id")
    .single();

  if (!newPlace) return null;
  usedGoogleIds.add(candidate.placeId);
  return { placeId: newPlace.id, googlePlaceId: candidate.placeId };
}

export async function fillSparseDaysForTrip(
  supabase: SupabaseClient,
  tripId: string,
  apiKey: string
): Promise<number> {
  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();

  if (!trip) return 0;

  const [{ data: hotel }, { data: placesRaw }, { data: days }] = await Promise.all([
    supabase.from("hotels").select("*").eq("trip_id", tripId).maybeSingle(),
    supabase.from("places").select("*").eq("trip_id", tripId),
    supabase
      .from("itinerary_days")
      .select("id, day_number, date")
      .eq("trip_id", tripId)
      .order("day_number"),
  ]);

  if (!hotel || !days?.length) return 0;

  const places = (placesRaw ?? []) as Place[];
  const { dayEndMinutes, dayStartMinutes } = parseDayBounds(
    trip.day_start_time,
    trip.day_end_time
  );
  const interests = (trip.interests ?? []) as TripInterest[];

  const { data: allStops } = await supabase
    .from("itinerary_stops")
    .select("*, place:places(*)")
    .in(
      "itinerary_day_id",
      days.map((d) => d.id)
    )
    .order("sort_order");

  const stopsByDay = new Map<string, StopRow[]>();
  for (const day of days) stopsByDay.set(day.id, []);
  for (const stop of (allStops ?? []) as StopRow[]) {
    stopsByDay.get(stop.itinerary_day_id)?.push(stop);
  }

  const usedGoogleIds = new Set(
    getSuggestionExcludeGoogleIds(
      places,
      (allStops ?? []).map((row) => {
        const place = normalizePlace(row);
        return { is_completed: row.is_completed ?? false, place };
      })
    )
  );
  const usedMealBrands = new Set<string>();
  for (const row of allStops ?? []) {
    const place = normalizePlace(row as StopRow);
    if (
      place?.name &&
      (place.category === "restaurant" || (row as StopRow).meal_type)
    ) {
      registerRestaurantBrand(place.name, usedMealBrands);
    }
  }

  const [interestPool, parksPool, experiencesPool] = await Promise.all([
    fetchTopSuggestions(
      hotel.lat,
      hotel.lng,
      trip.city,
      interests,
      [...usedGoogleIds],
      apiKey,
      60
    ),
    fetchParksAndNaturePool(
      hotel.lat,
      hotel.lng,
      trip.city,
      [...usedGoogleIds],
      apiKey,
      35
    ),
    fetchExperiencesPool(
      hotel.lat,
      hotel.lng,
      trip.city,
      [...usedGoogleIds],
      apiKey,
      25
    ),
  ]);

  const poolSeen = new Set(usedGoogleIds);
  const suggestionPool = [...parksPool, ...experiencesPool];
  for (const place of interestPool) {
    if (poolSeen.has(place.placeId)) continue;
    poolSeen.add(place.placeId);
    suggestionPool.push(place);
  }

  const travelTime = createEstimateTravelTimeFn();
  const tripInterestCounts = initTripInterestCounts(interests);
  let filledDays = 0;

  const tripWideDuplicateStopIds: string[] = [];
  const seenGoogleTrip = new Map<string, { stopId: string; manual: boolean }>();
  for (const day of days) {
    for (const stop of stopsByDay.get(day.id) ?? []) {
      const p = normalizePlace(stop);
      const gid = p?.google_place_id;
      if (!gid) continue;
      const isManual = p?.source === "manual";
      const existing = seenGoogleTrip.get(gid);
      if (!existing) {
        seenGoogleTrip.set(gid, { stopId: stop.id, manual: isManual });
      } else if (isManual && !existing.manual) {
        tripWideDuplicateStopIds.push(existing.stopId);
        seenGoogleTrip.set(gid, { stopId: stop.id, manual: true });
      } else {
        tripWideDuplicateStopIds.push(stop.id);
      }
    }
  }
  if (tripWideDuplicateStopIds.length > 0) {
    await supabase.from("itinerary_stops").delete().in("id", tripWideDuplicateStopIds);
    for (const day of days) {
      const dayStops = (stopsByDay.get(day.id) ?? []).filter(
        (s) => !tripWideDuplicateStopIds.includes(s.id)
      );
      stopsByDay.set(day.id, dayStops);
    }
  }

  for (const day of days) {
    let dayStops = stopsByDay.get(day.id) ?? [];

    const duplicateStopIds: string[] = [];
    const seenGoogleOnDay = new Set<string>();
    const seenPlaceIds = new Set<string>();
    for (const stop of dayStops) {
      const p = normalizePlace(stop);
      const gid = p?.google_place_id;
      if (gid) {
        if (seenGoogleOnDay.has(gid)) {
          duplicateStopIds.push(stop.id);
          continue;
        }
        seenGoogleOnDay.add(gid);
      }
      if (!stop.place_id) continue;
      if (seenPlaceIds.has(stop.place_id)) {
        duplicateStopIds.push(stop.id);
      } else {
        seenPlaceIds.add(stop.place_id);
      }
    }
    if (duplicateStopIds.length > 0) {
      await supabase.from("itinerary_stops").delete().in("id", duplicateStopIds);
      dayStops = dayStops.filter((s) => !duplicateStopIds.includes(s.id));
      stopsByDay.set(day.id, dayStops);
    }

    const hasRestRemainder = dayStops.some(
      (s) => s.stop_type === "rest" && (s.duration_minutes ?? 0) >= 180
    );
    if (hasRestRemainder) continue;

    const activityLocs = getActivityLocations(
      dayStops.map((s) => ({
        stop_type: s.stop_type,
        meal_type: s.meal_type,
        place: normalizePlace(s),
      }))
    );
    const excursionDay = isExcursionDay(
      { lat: hotel.lat, lng: hotel.lng },
      activityLocs
    );

    if (!dayNeedsFill(dayStops, { excursionDay })) continue;

    const dayThemes = new Set<string>();
    const dayInterests = new Set<TripInterest>();
    for (const stop of dayStops) {
      const p = normalizePlace(stop);
      if (p?.name) {
        dayThemes.add(placeTheme(p.name, p.category));
        const hits = interestsMatchedByCandidate({
          name: p.name,
          category: p.category,
        }).filter((interest) => interests.includes(interest));
        for (const interest of hits) dayInterests.add(interest);
      }
      if (stop.meal_type) dayInterests.add("restaurants");
    }

    const toAdd: {
      stop_type: string;
      meal_type?: string;
      duration_minutes: number;
      scheduled_time: string;
      is_suggested: boolean;
      place_id?: string;
    }[] = [];

    const mealCheckStops = () => [
      ...stopsForMealCheck(dayStops),
      ...toAdd.map((s) => ({
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        place: null,
      })),
    ];

    const workingMealStops = (): MealSlotStop[] => [
      ...dayStops.map((s) => ({
        id: s.id,
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        duration_minutes: s.duration_minutes,
        place: normalizePlace(s),
      })),
      ...toAdd
        .filter((s) => s.meal_type)
        .map((s) => ({
          meal_type: s.meal_type,
          stop_type: s.stop_type,
          scheduled_time: s.scheduled_time,
          duration_minutes: s.duration_minutes,
          place: { category: "restaurant" as const },
        })),
    ];

    for (const meal of dayMissingMeals(mealCheckStops())) {
      if (presentMealSlots(workingMealStops()).has(meal)) continue;

      const window = MEAL_WINDOWS[meal];
      const bounds = mealInsertionBounds(
        meal,
        workingMealStops(),
        day.date,
        { lat: hotel.lat, lng: hotel.lng }
      );
      if (!bounds) {
        console.info(
          `[fill-sparse] ${day.date} skip ${meal}: insertion bounds unavailable`
        );
        continue;
      }

      const searchAt = getMealSearchLocation(
        meal,
        { lat: hotel.lat, lng: hotel.lng },
        activityLocs
      );
      const lunchStart = earliestMealStart(workingMealStops(), "lunch");
      let resolved = await resolveMealPlace(
        supabase,
        tripId,
        meal,
        searchAt,
        trip.city,
        usedGoogleIds,
        usedMealBrands,
        apiKey,
        {
          date: day.date,
          bounds,
          lunchStart,
          workingStops: workingMealStops,
        }
      );
      if (!resolved) {
        resolved = await resolveMealPlace(
          supabase,
          tripId,
          meal,
          searchAt,
          trip.city,
          usedGoogleIds,
          usedMealBrands,
          apiKey,
          {
            date: day.date,
            bounds,
            lunchStart,
            workingStops: workingMealStops,
          },
          { relaxed: true }
        );
      }
      if (!resolved) {
        console.info(
          `[fill-sparse] ${day.date} ${meal} missing after candidate attempts`
        );
        continue;
      }
      if (isPlaceAlreadyOnDay([...dayStops.map(normalizeStopPlace), ...toAdd.map((s) => ({ place_id: s.place_id ?? null, place: null }))], resolved.placeId, resolved.googlePlaceId)) continue;

      toAdd.push({
        stop_type: "meal",
        meal_type: meal,
        duration_minutes: window.duration,
        scheduled_time: minutesToTimeString(resolved.mealStart),
        is_suggested: true,
        place_id: resolved.placeId,
      });
    }

    const sortedExisting = [...dayStops].sort((a, b) => {
      const ta = a.scheduled_time ? parseTimeToMinutes(a.scheduled_time) : 9999;
      const tb = b.scheduled_time ? parseTimeToMinutes(b.scheduled_time) : 9999;
      return ta - tb;
    });

    const activityWindow = getDayActivityWindow(sortedExisting, dayEndMinutes);
    let cursorMinutes = activityWindow.start;
    let cursorLocation = { lat: hotel.lat, lng: hotel.lng };
    const lunchStop = sortedExisting.find((s) => s.meal_type === "lunch");
    const anchorStop =
      lunchStop ??
      sortedExisting.find((s) => s.meal_type === "breakfast") ??
      [...sortedExisting].reverse().find((s) => normalizePlace(s));
    const anchorPlace = anchorStop ? normalizePlace(anchorStop) : null;
    if (anchorPlace) {
      cursorLocation = { lat: anchorPlace.lat, lng: anchorPlace.lng };
    }

    let addedActivities = 0;
    let sightseeingCount = countSightseeingStops(dayStops);
    const minSightseeing = 2;
    const targetStops = excursionDay ? 4 : 5;
    const activityDeadline = Math.min(
      excursionDay ? MEAL_WINDOWS.dinner.start : activityWindow.end,
      activityWindow.end
    );
    const dayGoogleIds = () => {
      const ids = getGooglePlaceIdsOnDay(dayStops.map(normalizeStopPlace));
      for (const item of toAdd) {
        if (!item.place_id) continue;
        const googleId = places.find((p) => p.id === item.place_id)?.google_place_id;
        if (googleId) ids.add(googleId);
      }
      return ids;
    };

    while (
      addedActivities < 3 &&
      (sightseeingCount < minSightseeing ||
        dayStops.length + toAdd.length < targetStops) &&
      cursorMinutes + 45 < activityDeadline
    ) {
      const rankedInterests = rankActivityInterests(
        interests,
        dayInterests,
        tripInterestCounts,
        addedActivities
      );
      const dayIds = dayGoogleIds();
      const slotExclude = new Set<string>();
      const candidates = orderedFillSparseCandidates(
        suggestionPool,
        rankedInterests,
        usedGoogleIds,
        dayIds,
        dayThemes,
        slotExclude
      );

      let placedThisRound = false;
      for (const candidate of candidates) {
        const category = candidate.category ?? "activity";
        const outdoor = isParkOrNaturePlace(candidate.types ?? [], candidate.name);
        const experience = isExperienceActivity(candidate.types ?? [], candidate.name);
        const duration = getDefaultVisitMinutes(category);

        const travel = await travelTime(cursorLocation, {
          lat: candidate.lat,
          lng: candidate.lng,
        });
        const travelStart = cursorMinutes + travel;
        const resolved = resolveVisitArrivalMinutes(
          day.date,
          Math.max(travelStart, activityWindow.start),
          category,
          duration,
          candidate.openingHours,
          { outdoor, experience }
        );
        if (resolved == null) continue;
        if (resolved + duration > activityDeadline) continue;

        dayThemes.add(placeTheme(candidate.name, candidate.category ?? "activity"));
        const interestHits = interestsMatchedByCandidate({
          name: candidate.name,
          category: candidate.category ?? "activity",
          outdoor: isParkOrNaturePlace(candidate.types ?? [], candidate.name),
          experience: isExperienceActivity(candidate.types ?? [], candidate.name),
        }).filter((interest) => interests.includes(interest));
        registerInterestHits(tripInterestCounts, dayInterests, interestHits);

        const { data: existing } = await supabase
          .from("places")
          .select("id")
          .eq("trip_id", tripId)
          .eq("google_place_id", candidate.placeId)
          .maybeSingle();

        let placeId = existing?.id;
        if (!placeId) {
          const { data: newPlace } = await supabase
            .from("places")
            .insert({
              trip_id: tripId,
              name: candidate.name,
              category: candidate.category ?? "activity",
              address: candidate.address,
              lat: candidate.lat,
              lng: candidate.lng,
              source: "suggested",
              google_place_id: candidate.placeId,
              rating: candidate.rating ?? null,
              photo_url: candidate.photoUrl ?? null,
              opening_hours: candidate.openingHours ?? null,
            })
            .select("id")
            .single();
          placeId = newPlace?.id;
        }

        if (!placeId) continue;

        usedGoogleIds.add(candidate.placeId);
        toAdd.push({
          stop_type: "place",
          duration_minutes: duration,
          scheduled_time: minutesToTimeString(resolved),
          is_suggested: true,
          place_id: placeId,
        });
        cursorMinutes = resolved + duration;
        cursorLocation = { lat: candidate.lat, lng: candidate.lng };
        addedActivities++;
        if (SIGHTSEEING_CATEGORIES.has(category)) {
          sightseeingCount++;
        }
        placedThisRound = true;
        break;
      }

      if (!placedThisRound) break;
    }

    if (toAdd.length === 0) continue;

    const merged = [
      ...dayStops.map((s) => ({
        id: s.id,
        sort_order: s.sort_order,
        stop_type: s.stop_type,
        meal_type: s.meal_type,
        duration_minutes: s.duration_minutes,
        scheduled_time: s.scheduled_time,
        is_suggested: s.is_suggested,
        place_id: s.place_id,
        place: normalizePlace(s),
        isNew: false as const,
      })),
      ...toAdd.map((s, i) => ({
        id: `new-${i}`,
        sort_order: dayStops.length + i,
        stop_type: s.stop_type,
        meal_type: s.meal_type ?? null,
        duration_minutes: s.duration_minutes,
        scheduled_time: s.scheduled_time,
        is_suggested: s.is_suggested,
        place_id: s.place_id ?? null,
        place: null as Place | null,
        isNew: true as const,
      })),
    ].sort((a, b) =>
      compareStopsByDayRhythm(
        {
          stop_type: a.stop_type,
          meal_type: a.meal_type,
          scheduled_time: a.scheduled_time,
          place: a.place
            ? {
                category: a.place.category,
                reservation_time: a.place.reservation_time ?? null,
              }
            : null,
        },
        {
          stop_type: b.stop_type,
          meal_type: b.meal_type,
          scheduled_time: b.scheduled_time,
          place: b.place
            ? {
                category: b.place.category,
                reservation_time: b.place.reservation_time ?? null,
              }
            : null,
        }
      )
    );

    const newStopIds: string[] = [];
    for (const item of merged) {
      if (!item.isNew) continue;
      const { data: inserted } = await supabase
        .from("itinerary_stops")
        .insert({
          itinerary_day_id: day.id,
          place_id: item.place_id,
          sort_order: 0,
          stop_type: item.stop_type,
          meal_type: item.meal_type,
          duration_minutes: item.duration_minutes,
          scheduled_time: item.scheduled_time,
          is_suggested: item.is_suggested,
        })
        .select("id, stop_type, duration_minutes, place:places(lat, lng, category)")
        .single();

      if (inserted) {
        newStopIds.push(inserted.id);
        item.id = inserted.id;
        const p = Array.isArray(inserted.place) ? inserted.place[0] : inserted.place;
        item.place = p as Place | null;
      }
    }

    const finalStops = merged.filter((s) => !s.isNew || newStopIds.includes(s.id));
    for (let i = 0; i < finalStops.length; i++) {
      await supabase
        .from("itinerary_stops")
        .update({ sort_order: i })
        .eq("id", finalStops[i].id);
    }

    await rescheduleItineraryDay(supabase, day.id, day.date);

    filledDays++;
  }

  return filledDays;
}
