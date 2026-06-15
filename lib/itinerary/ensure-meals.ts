import type { SupabaseClient } from "@supabase/supabase-js";
import type { Place } from "@/lib/types";
import { isSitDownRestaurant } from "@/lib/types";
import { rescheduleItineraryDay } from "@/lib/itinerary/apply-reschedule";
import {
  fetchAlternativeSuggestion,
  fetchMealSuggestionCandidates,
} from "@/lib/itinerary/google-places";
import {
  dayMissingMeals,
  getMealSearchLocation,
  getActivityLocations,
  isExcursionDay,
} from "@/lib/itinerary/meal-locations";
import {
  inferMealTypeFromMinutes,
  MEAL_WINDOWS,
  minutesToTimeString,
  type MealType,
  type OpeningHours,
} from "@/lib/itinerary/hours";
import {
  isRestaurantBrandUsed,
  registerRestaurantBrand,
} from "@/lib/itinerary/meal-dedup";
import { parseTimeToMinutes } from "@/lib/itinerary/reschedule-day";
import { compareStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import {
  breakfastInsertionSkipReason,
  effectiveLunchStartForBreakfastBounds,
  mealInsertionBounds,
  MEAL_ACTIVITY_GAP,
  mealStopsToRemove,
  minimumLunchStartAfterBreakfast,
  presentMealSlots,
  resolveMealStartMinutes,
  type MealSlotStop,
} from "@/lib/itinerary/meal-slots";
import {
  emptyMealRejectionCounts,
  logMealNotPlaced,
} from "@/lib/itinerary/generate-diagnostics";
import type { PlacesQuotaGate } from "@/lib/itinerary/places-quota-gate";
import type { TripInterest } from "@/lib/itinerary/interests";
import {
  gatherMealCandidatesForPostPass,
  loadPostPassDestinationPool,
  type PostPassDestinationPool,
} from "@/lib/itinerary/candidate-pool";

function normalizePlace(row: { place?: unknown }): Place | null {
  const p = row.place;
  return (Array.isArray(p) ? p[0] : p) as Place | null;
}

async function removeInvalidMealsAfterReschedule(
  supabase: SupabaseClient,
  dayId: string
): Promise<void> {
  const { data: refreshed } = await supabase
    .from("itinerary_stops")
    .select("id, stop_type, meal_type, scheduled_time, duration_minutes, place:places(*)")
    .eq("itinerary_day_id", dayId);

  const invalidIds = mealStopsToRemove(
    (refreshed ?? []).map((s) => ({
      id: s.id,
      meal_type: s.meal_type,
      stop_type: s.stop_type,
      scheduled_time: s.scheduled_time,
      duration_minutes: s.duration_minutes,
      place: normalizePlace(s),
    }))
  );
  if (invalidIds.length > 0) {
    await supabase.from("itinerary_stops").delete().in("id", invalidIds);
  }
}

function inferMealTypeForStop(
  stop: {
    meal_type?: string | null;
    scheduled_time?: string | null;
    place?: Place | null;
  }
): MealType | null {
  if (stop.meal_type) return stop.meal_type as MealType;
  const timeStr = stop.place?.reservation_time ?? stop.scheduled_time;
  if (!timeStr) return null;
  return inferMealTypeFromMinutes(parseTimeToMinutes(timeStr.slice(0, 8)));
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
): Promise<string | null> {
  usedGoogleIds.add(candidate.placeId);

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
    return existing.id;
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

  return newPlace?.id ?? null;
}

type MealInsertItem = {
  stop_type: string;
  meal_type: MealType;
  duration_minutes: number;
  scheduled_time: string;
  place_id: string;
};

async function collectMealCandidates(
  searchAt: { lat: number; lng: number },
  city: string,
  meal: MealType,
  usedGoogleIds: Set<string>,
  usedMealBrands: Set<string>,
  apiKey: string,
  postPassPool: PostPassDestinationPool | null,
  options?: { relaxed?: boolean },
  quotaGate?: PlacesQuotaGate
) {
  return gatherMealCandidatesForPostPass({
    meal,
    pool: postPassPool,
    lat: searchAt.lat,
    lng: searchAt.lng,
    city,
    usedGoogleIds,
    usedMealBrands,
    apiKey,
    relaxed: options?.relaxed ?? false,
    quotaGate,
    logPrefix: "ensure-meals",
    liveFetch: {
      fetchMealSuggestionCandidates,
      fetchAlternativeSuggestion,
    },
  });
}

async function tryScheduleMealInsertion(
  supabase: SupabaseClient,
  tripId: string,
  date: string,
  meal: MealType,
  bounds: { notBefore: number; notAfter: number },
  workingStops: () => MealSlotStop[],
  stops: {
    id: string;
    meal_type?: string | null;
    scheduled_time?: string | null;
    place?: Place | null;
  }[],
  searchAt: { lat: number; lng: number },
  city: string,
  usedGoogleIds: Set<string>,
  usedMealBrands: Set<string>,
  apiKey: string,
  postPassPool: PostPassDestinationPool | null,
  options?: { relaxed?: boolean },
  quotaGate?: PlacesQuotaGate
): Promise<MealInsertItem | null> {
  const relaxed = options?.relaxed ?? false;
  const window = MEAL_WINDOWS[meal];
  const candidates = await collectMealCandidates(
    searchAt,
    city,
    meal,
    usedGoogleIds,
    relaxed ? new Set<string>() : usedMealBrands,
    apiKey,
    postPassPool,
    { relaxed },
    quotaGate
  );
  const lunchStartForBreakfast = effectiveLunchStartForBreakfastBounds(workingStops());
  const lunchEndBoundary = lunchStartForBreakfast - MEAL_ACTIVITY_GAP;
  const rejections = emptyMealRejectionCounts();
  const notAfter = relaxed ? bounds.notAfter + 60 : bounds.notAfter;

  if (candidates.length === 0) {
    rejections.noCandidates = 1;
  }

  for (const candidate of candidates) {
    if (!isSitDownRestaurant(candidate.name)) {
      rejections.invalidMealCandidate++;
      continue;
    }
    if (!relaxed && isRestaurantBrandUsed(candidate.name, usedMealBrands)) {
      rejections.duplicateBrand++;
      continue;
    }

    const mealStart = resolveMealStartMinutes(date, meal, candidate.openingHours, {
      notBefore: bounds.notBefore,
      notAfter,
      lunchStart: lunchStartForBreakfast,
    });
    if (mealStart == null) {
      rejections.closedOrHoursFailed++;
      continue;
    }
    if (meal === "breakfast" && mealStart + window.duration > lunchEndBoundary) {
      rejections.outsideMealWindow++;
      continue;
    }

    const placeId = await persistMealCandidate(
      supabase,
      tripId,
      candidate,
      usedGoogleIds
    );
    if (!placeId) continue;
    registerRestaurantBrand(candidate.name, usedMealBrands);

    if (meal === "breakfast") {
      const minLunchStart = minimumLunchStartAfterBreakfast(mealStart);
      const lunchStop = stops.find((s) => s.meal_type === "lunch");
      if (
        lunchStop &&
        !lunchStop.place?.reservation_time &&
        lunchStop.scheduled_time
      ) {
        const currentLunch = parseTimeToMinutes(lunchStop.scheduled_time);
        if (currentLunch < minLunchStart) {
          const shifted = minutesToTimeString(minLunchStart);
          await supabase
            .from("itinerary_stops")
            .update({ scheduled_time: shifted })
            .eq("id", lunchStop.id);
          lunchStop.scheduled_time = shifted;
        }
      }
    }

    return {
      stop_type: "meal",
      meal_type: meal,
      duration_minutes: window.duration,
      scheduled_time: minutesToTimeString(mealStart),
      place_id: placeId,
    };
  }

  if (!relaxed && candidates.length > 0) {
    logMealNotPlaced({
      phase: "ensureTripMeals",
      date,
      meal,
      candidateCount: candidates.length,
      rejections,
    });
  }

  return null;
}

/**
 * Last-resort pass: every day gets breakfast, lunch, and dinner meal stops;
 * reserved restaurants get meal_type labels; then reschedule the day.
 */
export async function ensureTripMeals(
  supabase: SupabaseClient,
  tripId: string,
  apiKey: string,
  quotaGate?: PlacesQuotaGate
): Promise<void> {
  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) return;

  const [{ data: hotel }, { data: days }] = await Promise.all([
    supabase.from("hotels").select("*").eq("trip_id", tripId).maybeSingle(),
    supabase
      .from("itinerary_days")
      .select("id, day_number, date")
      .eq("trip_id", tripId)
      .order("day_number"),
  ]);
  if (!hotel || !days?.length) return;

  const [{ data: allPlaces }, { data: itineraryStopsRaw }] = await Promise.all([
    supabase.from("places").select("*").eq("trip_id", tripId),
    supabase
      .from("itinerary_stops")
      .select("is_completed, place:places(google_place_id, name)")
      .in(
        "itinerary_day_id",
        days.map((d) => d.id)
      ),
  ]);

  const itineraryStops = (itineraryStopsRaw ?? []).map((row) => {
    const place = Array.isArray(row.place) ? row.place[0] : row.place;
    return { is_completed: row.is_completed ?? false, place };
  });

  const usedGoogleIds = new Set(
    getSuggestionExcludeGoogleIds(
      (allPlaces ?? []) as Place[],
      itineraryStops
    )
  );
  const usedMealBrands = new Set<string>();
  for (const row of itineraryStops) {
    const name = row.place?.name;
    if (name) registerRestaurantBrand(name, usedMealBrands);
  }

  const interests = (trip.interests ?? []) as TripInterest[];
  const postPassPool = await loadPostPassDestinationPool(trip, interests, [...usedGoogleIds]);

  for (const day of days) {
    const { data: stopsRaw } = await supabase
      .from("itinerary_stops")
      .select("*, place:places(*)")
      .eq("itinerary_day_id", day.id)
      .order("sort_order");

    const stops = (stopsRaw ?? []).map((s) => ({
      ...s,
      place: normalizePlace(s),
    }));

    for (const stop of stops) {
      const inferred = inferMealTypeForStop(stop);
      if (
        inferred &&
        !stop.meal_type &&
        stop.place?.category === "restaurant"
      ) {
        await supabase
          .from("itinerary_stops")
          .update({ meal_type: inferred })
          .eq("id", stop.id);
        stop.meal_type = inferred;
      }
    }

    let invalidIds = mealStopsToRemove(
      stops.map((s) => ({
        id: s.id,
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        duration_minutes: s.duration_minutes,
        place: s.place,
      }))
    );
    if (invalidIds.length > 0) {
      await supabase.from("itinerary_stops").delete().in("id", invalidIds);
      for (const id of invalidIds) {
        const idx = stops.findIndex((s) => s.id === id);
        if (idx >= 0) stops.splice(idx, 1);
      }
    }

    const mealCheckStops = stops.map((s) => ({
      meal_type: s.meal_type,
      stop_type: s.stop_type,
      scheduled_time: s.scheduled_time,
      duration_minutes: s.duration_minutes,
      place: s.place,
    }));

    const missing = dayMissingMeals(mealCheckStops);
    if (missing.length === 0) {
      await rescheduleItineraryDay(supabase, day.id, day.date);
      await removeInvalidMealsAfterReschedule(supabase, day.id);
      continue;
    }

    const activityLocs = getActivityLocations(
      stops.map((s) => ({
        stop_type: s.stop_type,
        meal_type: s.meal_type,
        place: s.place,
      }))
    );

    const toInsert: {
      stop_type: string;
      meal_type: MealType;
      duration_minutes: number;
      scheduled_time: string;
      place_id: string;
    }[] = [];

    const workingStops = (): MealSlotStop[] => [
      ...stops.map((s) => ({
        id: s.id,
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        duration_minutes: s.duration_minutes,
        place: s.place,
      })),
      ...toInsert.map((item) => ({
        meal_type: item.meal_type,
        stop_type: item.stop_type,
        scheduled_time: item.scheduled_time,
        duration_minutes: item.duration_minutes,
        place: { category: "restaurant" as const },
      })),
    ];

    for (const meal of missing) {
      if (presentMealSlots(workingStops()).has(meal)) continue;

      const window = MEAL_WINDOWS[meal];
      const bounds = mealInsertionBounds(
        meal,
        workingStops(),
        day.date,
        { lat: hotel.lat, lng: hotel.lng }
      );
      if (!bounds) {
        const reason =
          meal === "breakfast"
            ? breakfastInsertionSkipReason(
                workingStops(),
                day.date,
                { lat: hotel.lat, lng: hotel.lng }
              )
            : `${meal} insertion bounds unavailable`;
        if (reason) {
          console.info(`[ensure-meals] ${day.date} skip ${meal}: ${reason}`);
        }
        continue;
      }

      const searchAt = getMealSearchLocation(
        meal,
        { lat: hotel.lat, lng: hotel.lng },
        activityLocs
      );

      const inserted = await tryScheduleMealInsertion(
        supabase,
        tripId,
        day.date,
        meal,
        bounds,
        workingStops,
        stops,
        searchAt,
        trip.city,
        usedGoogleIds,
        usedMealBrands,
        apiKey,
        postPassPool,
        undefined,
        quotaGate
      );
      if (inserted) {
        toInsert.push(inserted);
      } else {
        const relaxedInserted = await tryScheduleMealInsertion(
          supabase,
          tripId,
          day.date,
          meal,
          bounds,
          workingStops,
          stops,
          searchAt,
          trip.city,
          usedGoogleIds,
          usedMealBrands,
          apiKey,
          postPassPool,
          { relaxed: true },
          quotaGate
        );
        if (relaxedInserted) {
          toInsert.push(relaxedInserted);
        } else {
          console.info(
            `[ensure-meals] ${day.date} ${meal} missing after candidate attempts`
          );
        }
      }
    }

    if (toInsert.length === 0) {
      await rescheduleItineraryDay(supabase, day.id, day.date);
      await removeInvalidMealsAfterReschedule(supabase, day.id);
      continue;
    }

    for (let i = 0; i < toInsert.length; i++) {
      const item = toInsert[i];
      await supabase.from("itinerary_stops").insert({
        itinerary_day_id: day.id,
        place_id: item.place_id,
        sort_order: stops.length + i,
        stop_type: item.stop_type,
        meal_type: item.meal_type,
        duration_minutes: item.duration_minutes,
        scheduled_time: item.scheduled_time,
        is_suggested: true,
      });
    }

    const { data: refreshed } = await supabase
      .from("itinerary_stops")
      .select("id, sort_order, stop_type, meal_type, scheduled_time, duration_minutes, place:places(*)")
      .eq("itinerary_day_id", day.id);

    const dupeIds = mealStopsToRemove(
      (refreshed ?? []).map((s) => ({
        id: s.id,
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        duration_minutes: s.duration_minutes,
        place: normalizePlace(s),
      }))
    );
    if (dupeIds.length > 0) {
      await supabase.from("itinerary_stops").delete().in("id", dupeIds);
    }

    const { data: refreshedAfterDedupe } = await supabase
      .from("itinerary_stops")
      .select("id, sort_order, stop_type, meal_type, scheduled_time, place:places(category, reservation_time)")
      .eq("itinerary_day_id", day.id);

    const rhythmSorted = [...(refreshedAfterDedupe ?? [])].sort((a, b) =>
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

    for (let i = 0; i < rhythmSorted.length; i++) {
      await supabase
        .from("itinerary_stops")
        .update({ sort_order: i })
        .eq("id", rhythmSorted[i].id);
    }

    await rescheduleItineraryDay(supabase, day.id, day.date);
    await removeInvalidMealsAfterReschedule(supabase, day.id);
  }

  for (const day of days) {
    const { data: stopsRaw } = await supabase
      .from("itinerary_stops")
      .select("*, place:places(*)")
      .eq("itinerary_day_id", day.id)
      .order("sort_order");

    const stops = (stopsRaw ?? []).map((s) => ({
      ...s,
      place: normalizePlace(s),
    }));

    const activityLocs = getActivityLocations(
      stops.map((s) => ({
        stop_type: s.stop_type,
        meal_type: s.meal_type,
        place: s.place,
      }))
    );
    if (isExcursionDay({ lat: hotel.lat, lng: hotel.lng }, activityLocs)) continue;

    const mealCheckStops = stops.map((s) => ({
      meal_type: s.meal_type,
      stop_type: s.stop_type,
      scheduled_time: s.scheduled_time,
      duration_minutes: s.duration_minutes,
      place: s.place,
    }));
    if (!dayMissingMeals(mealCheckStops).includes("breakfast")) continue;

    const workingStops = (): MealSlotStop[] =>
      stops.map((s) => ({
        id: s.id,
        meal_type: s.meal_type,
        stop_type: s.stop_type,
        scheduled_time: s.scheduled_time,
        duration_minutes: s.duration_minutes,
        place: s.place,
      }));

    if (presentMealSlots(workingStops()).has("breakfast")) continue;

    const bounds = mealInsertionBounds(
      "breakfast",
      workingStops(),
      day.date,
      { lat: hotel.lat, lng: hotel.lng }
    );
    if (!bounds) continue;

    const searchAt = getMealSearchLocation(
      "breakfast",
      { lat: hotel.lat, lng: hotel.lng },
      activityLocs
    );
    const inserted = await tryScheduleMealInsertion(
      supabase,
      tripId,
      day.date,
      "breakfast",
      bounds,
      workingStops,
      stops,
      searchAt,
      trip.city,
      usedGoogleIds,
      usedMealBrands,
      apiKey,
      postPassPool,
      undefined,
      quotaGate
    );
    if (!inserted) {
      console.info(
        `[ensure-meals] ${day.date} breakfast still missing after final sweep`
      );
      continue;
    }

    await supabase.from("itinerary_stops").insert({
      itinerary_day_id: day.id,
      place_id: inserted.place_id,
      sort_order: stops.length,
      stop_type: inserted.stop_type,
      meal_type: inserted.meal_type,
      duration_minutes: inserted.duration_minutes,
      scheduled_time: inserted.scheduled_time,
      is_suggested: true,
    });

    await rescheduleItineraryDay(supabase, day.id, day.date);
    await removeInvalidMealsAfterReschedule(supabase, day.id);
  }
}
