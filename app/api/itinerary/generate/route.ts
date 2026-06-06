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
} from "@/lib/itinerary/google-places";
import { generateSmartItinerary } from "@/lib/itinerary/smart-generate";
import { fillSparseDaysForTrip } from "@/lib/itinerary/fill-sparse";
import { rescheduleAllItineraryDaysForTrip } from "@/lib/itinerary/apply-reschedule";
import {
  enrichPlacesInBackground,
  enrichPlacesOpeningHours,
} from "@/lib/itinerary/enrich-places";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import { ensureTripMeals } from "@/lib/itinerary/ensure-meals";
import {
  getManualPlaces,
  googlePlaceIdsForManualPlaces,
} from "@/lib/itinerary/manual-places";

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
  enrichPlacesInBackground(supabase, places, trip.city, apiKey);

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
  const excludeIds = getSuggestionExcludeGoogleIds(places, existingStops);

  const [interestPool, mealSuggestions, restaurantPool, parksPool, experiencesPool] =
    await Promise.all([
    fetchTopSuggestions(
      hotel.lat,
      hotel.lng,
      trip.city,
      interests,
      excludeIds,
      apiKey,
      80
    ),
    fetchMealsForDates(
      hotel.lat,
      hotel.lng,
      trip.city,
      dates,
      excludeIds,
      apiKey
    ),
    fetchTopSuggestions(
      hotel.lat,
      hotel.lng,
      trip.city,
      ["restaurants"],
      excludeIds,
      apiKey,
      40
    ),
    fetchParksAndNaturePool(
      hotel.lat,
      hotel.lng,
      trip.city,
      excludeIds,
      apiKey,
      35
    ),
    fetchExperiencesPool(
      hotel.lat,
      hotel.lng,
      trip.city,
      excludeIds,
      apiKey,
      35
    ),
  ]);

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

  const { data: existingDays } = await supabase
    .from("itinerary_days")
    .select("id")
    .eq("trip_id", tripId);

  if (existingDays?.length) {
    await supabase
      .from("itinerary_stops")
      .delete()
      .in(
        "itinerary_day_id",
        existingDays.map((d) => d.id)
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
    NonNullable<(typeof generated)[0]["stops"][0]["suggestedPlace"]>
  >();
  for (const day of generated) {
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
      generated.map((day) => ({
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

  for (const day of generated) {
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

  await fillSparseDaysForTrip(supabase, tripId, apiKey);

  const { data: allPlaces } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  await enrichPlacesOpeningHours(supabase, (allPlaces ?? []) as Place[], apiKey);

  await ensureTripMeals(supabase, tripId, apiKey);

  const { data: allPlacesAfterMeals } = await supabase
    .from("places")
    .select("*")
    .eq("trip_id", tripId);
  await enrichPlacesOpeningHours(supabase, (allPlacesAfterMeals ?? []) as Place[], apiKey);
  await rescheduleAllItineraryDaysForTrip(supabase, tripId);

  return NextResponse.json({ success: true });
}
