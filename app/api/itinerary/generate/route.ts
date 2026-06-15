import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTripDates, type Place, type TripInterest } from "@/lib/types";
import { MIN_INTERESTS } from "@/lib/itinerary/interests";
import { createEstimateTravelTimeFn } from "@/lib/itinerary/travel";
import {
  fetchMealsForDates,
  fetchExperiencesPool,
  fetchParksAndNaturePool,
  fetchTopSuggestions,
  searchMealPlaces,
} from "@/lib/itinerary/google-places";
import { generateSmartItinerary } from "@/lib/itinerary/smart-generate";
import { repairItineraryDensity } from "@/lib/itinerary/density-repair";
import { fillSparseDaysForTrip } from "@/lib/itinerary/fill-sparse";
import { rescheduleAllItineraryDaysForTrip } from "@/lib/itinerary/apply-reschedule";
import {
  enrichPlacesOpeningHours,
  hydratePlacesForGenerate,
  mergeStoredPlaceHydrationStats,
} from "@/lib/itinerary/enrich-places";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import { ensureTripMeals } from "@/lib/itinerary/ensure-meals";
import {
  getManualPlaces,
  googlePlaceIdsForManualPlaces,
} from "@/lib/itinerary/manual-places";
import {
  buildGenerateWarning,
  logGeneratePoolStats,
  logGenerateStart,
  logMissingMealsAfterGeneration,
  logPostGeneratePlaceHydration,
  logQualityGate,
  logStoredPlaceHydration,
  type MissingMealsDaySummary,
} from "@/lib/itinerary/generate-diagnostics";
import { dayMissingMeals } from "@/lib/itinerary/meal-locations";
import type { MealType } from "@/lib/itinerary/hours";
import {
  evaluateItineraryQualityGate,
  type ExistingItineraryStats,
} from "@/lib/itinerary/quality-gate";
import {
  createPlacesQuotaGate,
  QUOTA_EXHAUSTED_USER_MESSAGE,
} from "@/lib/itinerary/places-quota-gate";
import {
  assessPoolShortfalls,
  computeGeneratePoolThresholds,
  emptyGoogleTopUpPools,
  loadDestinationCandidates,
  loadGenerateCandidatePoolsFromDestinationPool,
  logPoolGenerateInputs,
  logPoolGoogleTopUp,
  logPoolRead,
  logPoolShortfall,
  logRestaurantMealFallback,
  mergeSearchResults,
  recordRestaurantFallbackSkips,
  resolveDestinationForTrip,
  topUpMealsFromGoogle,
  type GenerateFetchPools,
  type PoolTopUpStats,
  writeThroughGenerateCandidatePools,
} from "@/lib/itinerary/candidate-pool";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { tripId, interests, dayStartTime, dayEndTime } = body as {
    tripId: string;
    interests: TripInterest[];
    dayStartTime?: string;
    dayEndTime?: string;
  };

  if (!tripId || !interests?.length || interests.length < MIN_INTERESTS) {
    return NextResponse.json(
      { error: `Select at least ${MIN_INTERESTS} interests` },
      { status: 400 }
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const [{ data: hotel }, { data: placesRaw }] = await Promise.all([
    supabase.from("hotels").select("*").eq("trip_id", tripId).maybeSingle(),
    supabase.from("places").select("*").eq("trip_id", tripId),
  ]);

  if (!hotel) {
    return NextResponse.json({ error: "Add your hotel first" }, { status: 400 });
  }

  const places = (placesRaw ?? []) as Place[];
  const quotaGate = createPlacesQuotaGate();

  const hydrationStats = await hydratePlacesForGenerate(
    supabase,
    trip,
    places,
    apiKey,
    quotaGate
  );
  logStoredPlaceHydration(hydrationStats);

  const { data: existingStopsRaw } = await supabase
    .from("itinerary_stops")
    .select("is_completed, place:places(google_place_id), itinerary_days!inner(trip_id)")
    .eq("itinerary_days.trip_id", tripId);

  const existingStops = (existingStopsRaw ?? []).map((row) => {
    const place = Array.isArray(row.place) ? row.place[0] : row.place;
    return { is_completed: row.is_completed ?? false, place };
  });

  await supabase
    .from("trips")
    .update({
      interests,
      day_start_time: dayStartTime ?? "08:00:00",
      day_end_time: dayEndTime ?? "22:00:00",
    })
    .eq("id", tripId);

  const dates = getTripDates(trip.start_date, trip.end_date);
  logGenerateStart({ tripId, tripDayCount: dates.length });
  const excludeIds = getSuggestionExcludeGoogleIds(places, existingStops);
  const tripDayCount = dates.length;
  const thresholds = computeGeneratePoolThresholds(tripDayCount, interests);

  const destination = await resolveDestinationForTrip(trip);
  const poolRows = destination
    ? await loadDestinationCandidates(destination.destinationId, excludeIds)
    : [];

  const poolFromGlobal =
    poolRows.length > 0
      ? loadGenerateCandidatePoolsFromDestinationPool(poolRows, interests, dates, thresholds)
      : null;

  if (poolFromGlobal) {
    logRestaurantMealFallback({
      slug: destination?.slug ?? null,
      entries: poolFromGlobal.restaurantMealFallback,
    });
  }

  const emptyCounts = {
    totalLoaded: 0,
    interestPool: 0,
    restaurantPool: 0,
    parksPool: 0,
    experiencesPool: 0,
    breakfastTagged: 0,
    lunchTagged: 0,
    dinnerTagged: 0,
    breakfastMealPool: 0,
    lunchMealPool: 0,
    dinnerMealPool: 0,
    activitySightseeing: 0,
  };

  logPoolRead({
    slug: destination?.slug ?? null,
    destinationId: destination?.destinationId ?? null,
    globalCandidatesLoaded: poolRows.length,
    counts: poolFromGlobal?.counts ?? emptyCounts,
  });

  const shortfalls = assessPoolShortfalls(poolFromGlobal?.counts ?? emptyCounts, thresholds);
  logPoolShortfall({ slug: destination?.slug ?? null, shortfalls });

  const topUpStats: PoolTopUpStats = {
    skippedSufficient: [],
    skippedRestaurantFallback: [],
    attemptedShort: [],
    skippedQuota: [],
  };
  const googleTopUp: GenerateFetchPools = emptyGoogleTopUpPools();

  let interestPool = poolFromGlobal?.interestPool ?? [];
  let restaurantPool = poolFromGlobal?.restaurantPool ?? [];
  let parksPool = poolFromGlobal?.parksPool ?? [];
  let experiencesPool = poolFromGlobal?.experiencesPool ?? [];
  let mealSuggestions = poolFromGlobal?.mealSuggestions ?? new Map();

  const needsInterestTopUp =
    (poolFromGlobal?.counts.activitySightseeing ?? 0) < thresholds.activitySightseeing;
  if (!needsInterestTopUp) {
    topUpStats.skippedSufficient.push("interest");
  } else if (!quotaGate.allowLiveFetch()) {
    topUpStats.skippedQuota.push("interest");
  } else {
    topUpStats.attemptedShort.push("interest");
    const fetched = await fetchTopSuggestions(
      hotel.lat,
      hotel.lng,
      trip.city,
      interests,
      excludeIds,
      apiKey,
      80,
      quotaGate
    );
    googleTopUp.interestPool = fetched;
    interestPool = mergeSearchResults(interestPool, fetched, 80);
  }

  const needsRestaurantTopUp =
    (poolFromGlobal?.counts.restaurantPool ?? 0) < thresholds.restaurant;
  if (!needsRestaurantTopUp) {
    topUpStats.skippedSufficient.push("restaurant");
  } else if (!quotaGate.allowLiveFetch()) {
    topUpStats.skippedQuota.push("restaurant");
  } else {
    topUpStats.attemptedShort.push("restaurant");
    const fetched = await fetchTopSuggestions(
      hotel.lat,
      hotel.lng,
      trip.city,
      ["restaurants"],
      excludeIds,
      apiKey,
      40,
      quotaGate
    );
    googleTopUp.restaurantPool = fetched;
    restaurantPool = mergeSearchResults(restaurantPool, fetched, 40);
  }

  const needsParksTopUp =
    thresholds.parksNature != null &&
    (poolFromGlobal?.counts.parksPool ?? 0) < thresholds.parksNature;
  if (thresholds.parksNature == null) {
    topUpStats.skippedSufficient.push("parks_nature");
  } else if (!needsParksTopUp) {
    topUpStats.skippedSufficient.push("parks_nature");
  } else if (!quotaGate.allowLiveFetch()) {
    topUpStats.skippedQuota.push("parks_nature");
  } else {
    topUpStats.attemptedShort.push("parks_nature");
    const fetched = await fetchParksAndNaturePool(
      hotel.lat,
      hotel.lng,
      trip.city,
      excludeIds,
      apiKey,
      35,
      quotaGate
    );
    googleTopUp.parksPool = fetched;
    parksPool = mergeSearchResults(parksPool, fetched, 35);
  }

  const needsExperiencesTopUp =
    thresholds.experiences != null &&
    (poolFromGlobal?.counts.experiencesPool ?? 0) < thresholds.experiences;
  if (thresholds.experiences == null) {
    topUpStats.skippedSufficient.push("experiences");
  } else if (!needsExperiencesTopUp) {
    topUpStats.skippedSufficient.push("experiences");
  } else if (!quotaGate.allowLiveFetch()) {
    topUpStats.skippedQuota.push("experiences");
  } else {
    topUpStats.attemptedShort.push("experiences");
    const fetched = await fetchExperiencesPool(
      hotel.lat,
      hotel.lng,
      trip.city,
      excludeIds,
      apiKey,
      35,
      quotaGate
    );
    googleTopUp.experiencesPool = fetched;
    experiencesPool = mergeSearchResults(experiencesPool, fetched, 35);
  }

  const needsAnyMealTopUp =
    (poolFromGlobal?.counts.breakfastMealPool ?? 0) < thresholds.breakfast ||
    (poolFromGlobal?.counts.lunchMealPool ?? 0) < thresholds.lunch ||
    (poolFromGlobal?.counts.dinnerMealPool ?? 0) < thresholds.dinner;

  if (!poolFromGlobal || needsAnyMealTopUp) {
    if (!poolFromGlobal) {
      if (!quotaGate.allowLiveFetch()) {
        topUpStats.skippedQuota.push("meal_breakfast", "meal_lunch", "meal_dinner");
      } else {
        topUpStats.attemptedShort.push("meals_all");
        mealSuggestions = await fetchMealsForDates(
          hotel.lat,
          hotel.lng,
          trip.city,
          dates,
          excludeIds,
          apiKey,
          quotaGate
        );
        for (const [key, place] of mealSuggestions) {
          googleTopUp.mealSuggestions.set(key, place);
        }
      }
    } else {
      const mealResult = await topUpMealsFromGoogle(
        {
          lat: hotel.lat,
          lng: hotel.lng,
          city: trip.city,
          dates,
          excludeIds,
          apiKey,
          quotaGate,
          poolMealPools: poolFromGlobal.mealPools,
          thresholds,
          topUpStats,
          googleTopUp,
        },
        searchMealPlaces
      );
      mealSuggestions = mealResult.mealSuggestions;
      recordRestaurantFallbackSkips(
        poolFromGlobal.restaurantMealFallback,
        thresholds,
        topUpStats
      );
    }
  } else {
    topUpStats.skippedSufficient.push("meal_breakfast", "meal_lunch", "meal_dinner");
    recordRestaurantFallbackSkips(
      poolFromGlobal.restaurantMealFallback,
      thresholds,
      topUpStats
    );
  }

  logPoolGoogleTopUp({
    slug: destination?.slug ?? null,
    topUpStats,
    googleFetchedCounts: {
      interest: googleTopUp.interestPool.length,
      restaurant: googleTopUp.restaurantPool.length,
      parks: googleTopUp.parksPool.length,
      experiences: googleTopUp.experiencesPool.length,
      meals: googleTopUp.mealSuggestions.size,
    },
  });

  logPoolGenerateInputs({
    slug: destination?.slug ?? null,
    interestPoolCount: interestPool.length,
    restaurantPoolCount: restaurantPool.length,
    parksPoolCount: parksPool.length,
    experiencesPoolCount: experiencesPool.length,
    mealPrefetchSlots: mealSuggestions.size,
    fromGlobalPool: poolRows.length > 0,
  });

  await writeThroughGenerateCandidatePools(
    trip,
    { lat: hotel.lat, lng: hotel.lng },
    interests,
    googleTopUp
  );

  const poolSeen = new Set(excludeIds);
  const manualGoogleIds = googlePlaceIdsForManualPlaces(getManualPlaces(places));
  const suggestionPool = [...parksPool, ...experiencesPool];
  for (const place of interestPool) {
    if (poolSeen.has(place.placeId)) continue;
    if (manualGoogleIds.has(place.placeId)) continue;
    poolSeen.add(place.placeId);
    suggestionPool.push(place);
  }
  for (const place of restaurantPool) {
    if (poolSeen.has(place.placeId)) continue;
    if (manualGoogleIds.has(place.placeId)) continue;
    poolSeen.add(place.placeId);
    suggestionPool.push(place);
  }

  const manualPlaces = getManualPlaces(places);
  logGeneratePoolStats({
    interestPoolCount: interestPool.length,
    restaurantPoolCount: restaurantPool.length,
    parksPoolCount: parksPool.length,
    experiencesPoolCount: experiencesPool.length,
    suggestionPoolCount: suggestionPool.length,
    mealPrefetchSlots: mealSuggestions.size,
    manualPlaceCount: manualPlaces.length,
    tripDayCount: dates.length,
  });

  const travelTime = createEstimateTravelTimeFn();
  const generated = await generateSmartItinerary({
    places,
    dates,
    hotel: { lat: hotel.lat, lng: hotel.lng },
    interests,
    travelTime,
    dayStartTime: dayStartTime ?? trip.day_start_time ?? "08:00:00",
    dayEndTime: dayEndTime ?? trip.day_end_time ?? "22:00:00",
    suggestionPool,
    mealSuggestions,
  });

  const { days: repairedDays } = await repairItineraryDensity({
    days: generated,
    places,
    hotel: { lat: hotel.lat, lng: hotel.lng },
    interests,
    travelTime,
    dayStartTime: dayStartTime ?? trip.day_start_time ?? "08:00:00",
    dayEndTime: dayEndTime ?? trip.day_end_time ?? "22:00:00",
    interestPool,
    parksPool,
    experiencesPool,
  });

  const dayCount = repairedDays.length;
  const stopCount = repairedDays.reduce((sum, day) => sum + day.stops.length, 0);

  if (stopCount === 0) {
    quotaGate.logSummary();
    return NextResponse.json(
      {
        error: quotaGate.isQuotaExhausted()
          ? QUOTA_EXHAUSTED_USER_MESSAGE
          : "We couldn't generate an itinerary because no nearby places were available. Google Places may be unavailable or over quota. Please try again later or add places manually.",
      },
      { status: 503 }
    );
  }

  const { data: existingDaysForGate } = await supabase
    .from("itinerary_days")
    .select("id, day_number, date")
    .eq("trip_id", tripId);

  let existingStats: ExistingItineraryStats | null = null;
  if (existingDaysForGate?.length) {
    const { data: existingStopRows } = await supabase
      .from("itinerary_stops")
      .select(
        "itinerary_day_id, stop_type, meal_type, scheduled_time, duration_minutes, place:places(category, reservation_time)"
      )
      .in(
        "itinerary_day_id",
        existingDaysForGate.map((day) => day.id)
      );

    const stopsByDayId = new Map<string, NonNullable<typeof existingStopRows>>();
    for (const stop of existingStopRows ?? []) {
      const bucket = stopsByDayId.get(stop.itinerary_day_id) ?? [];
      bucket.push(stop);
      stopsByDayId.set(stop.itinerary_day_id, bucket);
    }

    let existingMissingMealDayCount = 0;
    for (const day of existingDaysForGate) {
      const dayStops = stopsByDayId.get(day.id) ?? [];
      const missing = dayMissingMeals(
        dayStops.map((s) => {
          const place = Array.isArray(s.place) ? s.place[0] : s.place;
          return {
            meal_type: s.meal_type,
            stop_type: s.stop_type,
            scheduled_time: s.scheduled_time,
            duration_minutes: s.duration_minutes,
            place: place
              ? {
                  category: place.category,
                  reservation_time: place.reservation_time,
                }
              : null,
          };
        })
      ) as MealType[];
      if (missing.length > 0) existingMissingMealDayCount += 1;
    }

    existingStats = {
      dayCount: existingDaysForGate.length,
      stopCount: existingStopRows?.length ?? 0,
      missingMealDayCount: existingMissingMealDayCount,
    };
  }

  const qualityGate = evaluateItineraryQualityGate({
    generatedDays: repairedDays,
    tripDayCount: dates.length,
    hotel: { lat: hotel.lat, lng: hotel.lng },
    existing: existingStats,
  });
  logQualityGate(qualityGate, (existingStats?.stopCount ?? 0) > 0);

  if (qualityGate.severity === "block") {
    quotaGate.logSummary();
    const hasExistingItinerary = (existingStats?.stopCount ?? 0) > 0;
    return NextResponse.json(
      {
        error: hasExistingItinerary
          ? "Generated itinerary did not meet quality standards, so your existing itinerary was preserved."
          : "Generated itinerary did not meet quality standards. Please try again later or adjust your trip preferences.",
        qualityGate: {
          severity: qualityGate.severity,
          shouldBlockReplacement: qualityGate.shouldBlockReplacement,
          reasons: qualityGate.reasons,
          diagnostics: qualityGate.diagnostics,
        },
      },
      { status: hasExistingItinerary ? 409 : 422 }
    );
  }

  if (existingDaysForGate?.length) {
    await supabase
      .from("itinerary_stops")
      .delete()
      .in(
        "itinerary_day_id",
        existingDaysForGate.map((d) => d.id)
      );
    await supabase.from("itinerary_days").delete().eq("trip_id", tripId);
  }

  const googleIdToPlaceId = new Map<string, string>(
    places
      .filter((p) => p.google_place_id)
      .map((p) => [p.google_place_id!, p.id])
  );

  const newSuggestedPlaces = new Map<
    string,
    NonNullable<(typeof repairedDays)[0]["stops"][0]["suggestedPlace"]>
  >();
  for (const day of repairedDays) {
    for (const stop of day.stops) {
      if (
        stop.suggestedPlace &&
        !googleIdToPlaceId.has(stop.suggestedPlace.placeId)
      ) {
        newSuggestedPlaces.set(stop.suggestedPlace.placeId, stop.suggestedPlace);
      }
    }
  }

  if (newSuggestedPlaces.size > 0) {
    const { data: insertedPlaces } = await supabase
      .from("places")
      .insert(
        [...newSuggestedPlaces.values()].map((sp) => ({
          trip_id: tripId,
          name: sp.name,
          category: sp.category,
          address: sp.address,
          lat: sp.lat,
          lng: sp.lng,
          source: "suggested" as const,
          google_place_id: sp.placeId,
          rating: sp.rating ?? null,
          photo_url: sp.photoUrl ?? null,
          opening_hours: sp.openingHours ?? null,
        }))
      )
      .select("id, google_place_id");

    for (const row of insertedPlaces ?? []) {
      if (row.google_place_id) {
        googleIdToPlaceId.set(row.google_place_id, row.id);
      }
    }
  }

  const { data: dayRows } = await supabase
    .from("itinerary_days")
    .insert(
      repairedDays.map((day) => ({
        trip_id: tripId,
        day_number: day.dayNumber,
        date: day.date,
      }))
    )
    .select("id, day_number");

  if (!dayRows?.length) {
    return NextResponse.json({ error: "Failed to create days" }, { status: 500 });
  }

  const dayIdByNumber = new Map(dayRows.map((d) => [d.day_number, d.id]));
  const stopRows: Record<string, unknown>[] = [];

  for (const day of repairedDays) {
    const dayRowId = dayIdByNumber.get(day.dayNumber);
    if (!dayRowId) continue;

    for (let i = 0; i < day.stops.length; i++) {
      const stop = day.stops[i];
      let placeId = stop.placeId ?? null;

      if (stop.suggestedPlace) {
        placeId = googleIdToPlaceId.get(stop.suggestedPlace.placeId) ?? placeId;
      }

      stopRows.push({
        itinerary_day_id: dayRowId,
        place_id: placeId,
        sort_order: i,
        stop_type: stop.stopType,
        meal_type: stop.mealType ?? null,
        title: stop.title ?? null,
        duration_minutes: stop.durationMinutes,
        scheduled_time: stop.scheduledTime,
        suggestion_key: stop.suggestionKey ?? null,
        is_suggested:
          stop.isSuggested ||
          (placeId
            ? places.find((p) => p.id === placeId)?.source === "suggested"
            : true),
      });
    }
  }

  if (stopRows.length > 0) {
    const { error: stopError } = await supabase.from("itinerary_stops").insert(stopRows);
    if (stopError) {
      return NextResponse.json({ error: stopError.message }, { status: 500 });
    }
  }

  await fillSparseDaysForTrip(supabase, tripId, apiKey, quotaGate);

  const { data: allPlaces } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  const postGenerateHydrationAfterFillSparse = await enrichPlacesOpeningHours(
    supabase,
    (allPlaces ?? []) as Place[],
    apiKey,
    quotaGate,
    trip
  );

  await ensureTripMeals(supabase, tripId, apiKey, quotaGate);

  const { data: allPlacesAfterMeals } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  const postGenerateHydrationAfterMeals = await enrichPlacesOpeningHours(
    supabase,
    (allPlacesAfterMeals ?? []) as Place[],
    apiKey,
    quotaGate,
    trip
  );
  logPostGeneratePlaceHydration(
    mergeStoredPlaceHydrationStats(
      postGenerateHydrationAfterFillSparse,
      postGenerateHydrationAfterMeals
    )
  );

  await rescheduleAllItineraryDaysForTrip(supabase, tripId);

  const { data: finalDays } = await supabase
    .from("itinerary_days")
    .select("id, day_number, date")
    .eq("trip_id", tripId)
    .order("day_number");

  const missingMealSummaries: MissingMealsDaySummary[] = [];
  for (const day of finalDays ?? []) {
    const { data: dayStops } = await supabase
      .from("itinerary_stops")
      .select("stop_type, meal_type, scheduled_time, duration_minutes, place:places(category, reservation_time)")
      .eq("itinerary_day_id", day.id);

    const missing = dayMissingMeals(
      (dayStops ?? []).map((s) => {
        const place = Array.isArray(s.place) ? s.place[0] : s.place;
        return {
          meal_type: s.meal_type,
          stop_type: s.stop_type,
          scheduled_time: s.scheduled_time,
          duration_minutes: s.duration_minutes,
          place: place
            ? {
                category: place.category,
                reservation_time: place.reservation_time,
              }
            : null,
        };
      })
    ) as MealType[];

    missingMealSummaries.push({
      dayNumber: day.day_number,
      date: day.date,
      missing,
    });
  }

  logMissingMealsAfterGeneration(missingMealSummaries);
  quotaGate.logSummary();
  const mealWarning = buildGenerateWarning(
    missingMealSummaries,
    dayCount,
    quotaGate.isQuotaExhausted()
  );
  const qualityWarning =
    qualityGate.severity === "warning"
      ? "Your itinerary was created, but some days may still need more stops or meals."
      : undefined;
  const warning = [mealWarning, qualityWarning].filter(Boolean).join(" ") || undefined;

  return NextResponse.json({
    success: true,
    dayCount,
    stopCount,
    ...(warning ? { warning } : {}),
    ...(qualityGate.severity === "warning"
      ? {
          qualityGate: {
            severity: qualityGate.severity,
            shouldBlockReplacement: qualityGate.shouldBlockReplacement,
            reasons: qualityGate.reasons,
            diagnostics: qualityGate.diagnostics,
          },
        }
      : {}),
  });
}
