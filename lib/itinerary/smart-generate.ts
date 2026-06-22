// @ts-nocheck
import type { LatLng, MealType, Place, PlaceSearchResult, StopType, TripInterest } from "@/lib/types";
import { googleTypeToCategory, isExperienceActivity, isParkOrNaturePlace, isSitDownRestaurant } from "@/lib/types";
import { placeHasReservation } from "@/lib/utils";
import {
  adjustStartForOpeningHours,
  getCategoryEarliestOpen,
  getDefaultVisitMinutes,
  getEarliestOpenMinutes,
  getMealEarliestMinutes,
  isCategoryAppropriateAtTime,
  isVisitAppropriateAtTime,
  isMealAppropriateTime,
  isOpenAt,
  MEAL_WINDOWS,
  minutesToTimeString,
} from "@/lib/itinerary/hours";
import type { TravelTimeFn } from "@/lib/itinerary/travel";
import { placeTheme, recordTheme, themeAllowed } from "@/lib/itinerary/place-theme";
import {
  dayMissingMeals,
  excursionVisitMinutes,
  getActivityLocations,
  getMealSearchLocation,
  isExcursionPlace,
  mealsEnabled,
  splitByExcursionDistance,
} from "@/lib/itinerary/meal-locations";
import { recomputeScheduleTimes, type ScheduleTimeStop } from "@/lib/itinerary/schedule-times";
import {
  ACTIVITY_SLOT_INTERESTS,
  candidateMatchesInterest,
  initTripInterestCounts,
  interestsMatchedByCandidate,
  rankActivityInterests,
  registerInterestHits,
  type InterestCandidate,
} from "@/lib/itinerary/interest-scheduling";
import { parseDayBounds } from "@/lib/itinerary/reschedule-day";
import { compareStopsByDayRhythm, sortStopsByDayRhythm } from "@/lib/itinerary/day-rhythm";
import {
  assignManualPlacesToDays,
  getManualPlaces,
  googlePlaceIdsForManualPlaces,
} from "@/lib/itinerary/manual-places";
import {
  isRestaurantBrandUsed,
  registerRestaurantBrand,
} from "@/lib/itinerary/meal-dedup";
import {
  emptyMealRejectionCounts,
  logDayScheduleDiagnostics,
  logGenerateResult,
  logMealNotPlaced,
} from "@/lib/itinerary/generate-diagnostics";
import {
  tryInsertMealViaGaps,
} from "@/lib/itinerary/meal-gap-insert";

export interface SuggestedPlaceInput {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  category: import("@/lib/types").PlaceCategory;
  photoUrl?: string | null;
  openingHours?: import("@/lib/itinerary/hours").OpeningHours | null;
  outdoor?: boolean;
  experience?: boolean;
}

export interface SmartItineraryDayStop {
  stopType: StopType;
  placeId?: string;
  place?: Place;
  suggestedPlace?: SuggestedPlaceInput;
  mealType?: MealType;
  durationMinutes: number;
  scheduledTime: string;
  suggestionKey?: string;
  isSuggested: boolean;
  title?: string;
}

export interface SmartItineraryDay {
  dayNumber: number;
  date: string;
  stops: SmartItineraryDayStop[];
}

export interface SmartItineraryInput {
  places: Place[];
  dates: string[];
  hotel: LatLng;
  interests: TripInterest[];
  travelTime: TravelTimeFn;
  dayStartTime?: string;
  dayEndTime?: string;
  suggestionPool: PlaceSearchResult[];
  mealSuggestions: Map<string, PlaceSearchResult>;
}

interface SchedulerContext {
  date: string;
  hotel: LatLng;
  interests: TripInterest[];
  travelTime: TravelTimeFn;
  dayStartMinutes: number;
  dayEndMinutes: number;
  usedPlaceIds: Set<string>;
  usedGoogleIds: Set<string>;
  usedMealBrandKeys: Set<string>;
  savedGoogleIds: Set<string>;
  manualGoogleIds: Set<string>;
  dayUsedPlaceIds: Set<string>;
  dayUsedGoogleIds: Set<string>;
  dayThemes: Set<string>;
  dayInterests: Set<TripInterest>;
  tripInterestCounts: Map<TripInterest, number>;
  suggestionPool: SuggestedPlaceInput[];
  mealSuggestions: Map<string, SuggestedPlaceInput>;
}

interface ScheduleCursor {
  minutes: number;
  location: LatLng;
}

type DraftStop = Omit<SmartItineraryDayStop, "scheduledTime"> & { scheduledTime?: string };

const EVENING_CATEGORIES = [
    "bar",
    "nightlife"
];
function parseReservationMinutes(time) {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
}
function parseTimeInput(time, fallback) {
    if (!time) return fallback;
    const [h, m] = time.split(":").map(Number);
    return h * 60 + (m || 0);
}
function parseSchedulerDayBounds(dayStartTime, dayEndTime) {
    return parseDayBounds(dayStartTime, dayEndTime, {
        start: "08:00:00",
        end: "22:00:00"
    });
}
export function toSuggestedInput(result) {
    const types = result.types ?? [];
    return {
        placeId: result.placeId,
        name: result.name,
        address: result.address,
        lat: result.lat,
        lng: result.lng,
        rating: result.rating,
        category: result.category ?? googleTypeToCategory(types, result.name),
        photoUrl: result.photoUrl,
        openingHours: result.openingHours ?? null,
        outdoor: isParkOrNaturePlace(types, result.name),
        experience: isExperienceActivity(types, result.name)
    };
}
function activityCategoriesForInterests(interests) {
    const cats = [];
    if (interests.includes("monuments")) cats.push("monument");
    if (interests.includes("museums")) cats.push("museum");
    if (interests.includes("activities") || interests.includes("parks") || interests.includes("shopping")) {
        cats.push("activity");
    }
    return cats.length > 0 ? cats : [
        "monument",
        "museum",
        "activity"
    ];
}
function pickSuggestion(ctx, near, categories, startMinutes, excludeRestaurant = true, options) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of ctx.suggestionPool){
        if (ctx.usedGoogleIds.has(candidate.placeId)) continue;
        if (ctx.dayUsedGoogleIds.has(candidate.placeId)) continue;
        if (!options?.includeSaved && ctx.savedGoogleIds.has(candidate.placeId)) continue;
        if (!categories.includes(candidate.category)) continue;
        if (excludeRestaurant && candidate.category === "restaurant") continue;
        if (options?.preferInterest && !candidateMatchesInterest(candidate, options.preferInterest)) {
            continue;
        }
        if (candidate.category !== "restaurant" && !themeAllowed(ctx.dayThemes, candidate.name, candidate.category)) {
            continue;
        }
        const duration = getDefaultVisitMinutes(candidate.category);
        if (!options?.relaxHours) {
            const outdoor = isParkOrNaturePlace([], candidate.name);
            const experience = isExperienceActivity([], candidate.name);
            if (
                !isOpenAt(ctx.date, startMinutes, duration, candidate.category, candidate.openingHours) ||
                !isVisitAppropriateAtTime(candidate.category, startMinutes, duration, { outdoor, experience })
            ) {
                continue;
            }
        }
        const dist = Math.hypot(candidate.lat - near.lat, candidate.lng - near.lng);
        const score = (candidate.rating ?? 4) * 20 - dist * 100;
        if (options?.excludePlaceIds?.has(candidate.placeId)) continue;
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}
function registerSuggestionInterests(ctx, candidate) {
    const hits = interestsMatchedByCandidate(candidate).filter((interest)=>ctx.interests.includes(interest) && (ACTIVITY_SLOT_INTERESTS.includes(interest) || interest === "restaurants" || interest === "bars_nightlife"));
    if (hits.length > 0) {
        registerInterestHits(ctx.tripInterestCounts, ctx.dayInterests, hits);
    }
}
function registerPlaceInterests(ctx, place) {
    const hits = interestsMatchedByCandidate({
        name: place.name,
        category: place.category,
        outdoor: isParkOrNaturePlace([], place.name),
        experience: isExperienceActivity([], place.name)
    }).filter((interest)=>ctx.interests.includes(interest));
    if (hits.length > 0) {
        registerInterestHits(ctx.tripInterestCounts, ctx.dayInterests, hits);
    }
}
function registerMealInterest(ctx) {
    if (ctx.interests.includes("restaurants")) {
        registerInterestHits(ctx.tripInterestCounts, ctx.dayInterests, [
            "restaurants"
        ]);
    }
}
function pickBalancedActivitySuggestion(ctx, near, categories, startMinutes, slotIndex, options) {
    const ranked = rankActivityInterests(ctx.interests, ctx.dayInterests, ctx.tripInterestCounts, slotIndex);
    for (const interest of ranked){
        const pick = pickSuggestion(ctx, near, categories, startMinutes, true, {
            preferInterest: interest,
            excludePlaceIds: options?.excludePlaceIds
        });
        if (pick) return pick;
    }
    return pickSuggestion(ctx, near, categories, startMinutes, true, {
        excludePlaceIds: options?.excludePlaceIds
    });
}
function pickMealSuggestion(ctx, near, meal, date, startMinutes) {
    const key = `${date}-${meal}`;
    const cached = ctx.mealSuggestions.get(key);
    const isValidMeal = (candidate)=>!candidate.experience && isSitDownRestaurant(candidate.name) && !ctx.manualGoogleIds.has(candidate.placeId);
    if (cached && !ctx.usedGoogleIds.has(cached.placeId) && !isRestaurantBrandUsed(cached.name, ctx.usedMealBrandKeys) && isValidMeal(cached)) {
        return cached;
    }
    // Prefetch slot taken — try another cached restaurant for this meal type.
    for (const [slotKey, candidate] of ctx.mealSuggestions){
        if (!slotKey.endsWith(`-${meal}`)) continue;
        if (ctx.usedGoogleIds.has(candidate.placeId)) continue;
        if (ctx.manualGoogleIds.has(candidate.placeId)) continue;
        if (isRestaurantBrandUsed(candidate.name, ctx.usedMealBrandKeys)) continue;
        if (!isValidMeal(candidate)) continue;
        return candidate;
    }
    const fallback = pickSuggestion(ctx, near, [
        "restaurant"
    ], startMinutes, false, {
        includeSaved: true
    });
    if (fallback && isValidMeal(fallback)) return fallback;
    // Pool exhausted — reuse a prefetched restaurant rather than skip the meal.
    if (cached && isValidMeal(cached)) return cached;
    for (const [, candidate] of ctx.mealSuggestions){
        if ((candidate.category === "restaurant" || candidate.category === undefined) && isValidMeal(candidate)) {
            return candidate;
        }
    }
    return null;
}
function collectMealCandidates(ctx, meal, date) {
    const seen = new Set();
    const out = [];
    const add = (candidate)=>{
        if (!candidate || seen.has(candidate.placeId)) return;
        seen.add(candidate.placeId);
        out.push(candidate);
    };
    add(ctx.mealSuggestions.get(`${date}-${meal}`));
    for (const [slotKey, candidate] of ctx.mealSuggestions){
        if (slotKey.endsWith(`-${meal}`)) add(candidate);
    }
    for (const candidate of ctx.suggestionPool){
        if (candidate.category === "restaurant") add(candidate);
    }
    return out;
}
function googleIdForStop(stop) {
    if (stop.place?.google_place_id) return stop.place.google_place_id;
    if (stop.suggestedPlace?.placeId) return stop.suggestedPlace.placeId;
    return null;
}
function stopDedupKey(stop) {
    if (stop.mealType) {
        return `meal-${stop.mealType}-${stop.suggestionKey ?? stop.suggestedPlace?.placeId ?? stop.placeId ?? stop.scheduledTime}`;
    }
    const googleId = googleIdForStop(stop);
    if (googleId) return `google-${googleId}`;
    return stop.suggestionKey ?? stop.placeId ?? stop.scheduledTime ?? "";
}
function dedupeStopsPreferManual(stops) {
    const byKey = new Map();
    for (const stop of stops) {
        const key = stopDedupKey(stop);
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, stop);
        } else if (!stop.isSuggested && prev.isSuggested) {
            byKey.set(key, stop);
        }
    }
    return [
        ...byKey.values()
    ];
}
function evictSuggestedGoogleDuplicate(stops, googlePlaceId) {
    const idx = stops.findIndex((s)=>s.isSuggested && googleIdForStop(s) === googlePlaceId);
    if (idx >= 0) stops.splice(idx, 1);
}
function markStopPlaceUsed(ctx, stop) {
    if (stop.placeId) ctx.usedPlaceIds.add(stop.placeId);
    if (stop.place?.id) ctx.usedPlaceIds.add(stop.place.id);
    const gid = stop.place?.google_place_id ?? stop.suggestedPlace?.placeId;
    if (gid) {
        ctx.usedGoogleIds.add(gid);
        ctx.dayUsedGoogleIds.add(gid);
    }
    if (stop.place?.id) ctx.dayUsedPlaceIds.add(stop.place.id);
    if (stop.stopType === "meal" && stop.suggestedPlace?.name) {
        registerRestaurantBrand(stop.suggestedPlace.name, ctx.usedMealBrandKeys);
    }
}
async function pushStop(ctx, stops, cursor, stop, travelTime) {
    let start = stop.scheduledTime ? parseReservationMinutes(stop.scheduledTime) : cursor.minutes;
    if (!stop.scheduledTime && stop.suggestedPlace) {
        const travel = await travelTime(cursor.location, {
            lat: stop.suggestedPlace.lat,
            lng: stop.suggestedPlace.lng
        });
        start = cursor.minutes + travel;
    } else if (!stop.scheduledTime && stop.place) {
        const travel = await travelTime(cursor.location, {
            lat: stop.place.lat,
            lng: stop.place.lng
        });
        start = cursor.minutes + travel;
    }
    stops.push({
        ...stop,
        scheduledTime: minutesToTimeString(start)
    });
    if (stop.stopType === "meal" && stop.mealType) {
        ctx.dayThemes.add(`meal-${stop.mealType}`);
    } else if (stop.place) {
        recordTheme(ctx.dayThemes, stop.place.name, stop.place.category);
    } else if (stop.suggestedPlace) {
        recordTheme(ctx.dayThemes, stop.suggestedPlace.name, stop.suggestedPlace.category);
    }
    markStopPlaceUsed(ctx, stop);
    cursor.minutes = start + stop.durationMinutes;
    cursor.location = stop.place ? {
        lat: stop.place.lat,
        lng: stop.place.lng
    } : stop.suggestedPlace ? {
        lat: stop.suggestedPlace.lat,
        lng: stop.suggestedPlace.lng
    } : cursor.location;
}
async function addActivities(ctx, stops, cursor, userPlaces, categories, maxCount, deadlineMinutes) {
    let added = 0;
    while(added < maxCount && cursor.minutes + 45 < deadlineMinutes){
        let placed = false;
        for (const place of userPlaces){
            if (ctx.usedPlaceIds.has(place.id)) continue;
            if (!categories.includes(place.category)) continue;
            const duration = excursionVisitMinutes(ctx.hotel, place, getDefaultVisitMinutes(place.category));
            const travel = await ctx.travelTime(cursor.location, {
                lat: place.lat,
                lng: place.lng
            });
            const start = cursor.minutes + travel;
            if (start + duration > deadlineMinutes) continue;
            if (!isOpenAt(ctx.date, start, duration, place.category, place.opening_hours) || !isCategoryAppropriateAtTime(place.category, start)) {
                continue;
            }
            if (!themeAllowed(ctx.dayThemes, place.name, place.category)) continue;
            await pushStop(ctx, stops, cursor, {
                stopType: "place",
                placeId: place.id,
                place,
                durationMinutes: duration,
                isSuggested: place.source === "suggested"
            }, ctx.travelTime);
            ctx.usedPlaceIds.add(place.id);
            registerPlaceInterests(ctx, place);
            added++;
            placed = true;
            break;
        }
        if (placed) continue;
        const slotExclude = new Set();
        let suggestionPlaced = false;
        const ranked = rankActivityInterests(ctx.interests, ctx.dayInterests, ctx.tripInterestCounts, added);
        for (const interest of ranked){
            if (suggestionPlaced) break;
            while(true){
                const suggested = pickSuggestion(ctx, cursor.location, categories, cursor.minutes + 10, true, {
                    preferInterest: interest,
                    excludePlaceIds: slotExclude
                });
                if (!suggested) break;
                const travel = await ctx.travelTime(cursor.location, {
                    lat: suggested.lat,
                    lng: suggested.lng
                });
                const duration = getDefaultVisitMinutes(suggested.category);
                if (cursor.minutes + travel + duration > deadlineMinutes) {
                    slotExclude.add(suggested.placeId);
                    continue;
                }
                await pushStop(ctx, stops, cursor, {
                    stopType: "place",
                    suggestedPlace: suggested,
                    durationMinutes: duration,
                    suggestionKey: `${ctx.date}-activity-${added}`,
                    isSuggested: true
                }, ctx.travelTime);
                registerSuggestionInterests(ctx, suggested);
                added++;
                suggestionPlaced = true;
                break;
            }
        }
        if (!suggestionPlaced) {
            while(true){
                const suggested = pickSuggestion(ctx, cursor.location, categories, cursor.minutes + 10, true, {
                    excludePlaceIds: slotExclude
                });
                if (!suggested) break;
                const travel = await ctx.travelTime(cursor.location, {
                    lat: suggested.lat,
                    lng: suggested.lng
                });
                const duration = getDefaultVisitMinutes(suggested.category);
                if (cursor.minutes + travel + duration > deadlineMinutes) {
                    slotExclude.add(suggested.placeId);
                    continue;
                }
                await pushStop(ctx, stops, cursor, {
                    stopType: "place",
                    suggestedPlace: suggested,
                    durationMinutes: duration,
                    suggestionKey: `${ctx.date}-activity-${added}`,
                    isSuggested: true
                }, ctx.travelTime);
                registerSuggestionInterests(ctx, suggested);
                added++;
                suggestionPlaced = true;
                break;
            }
        }
        if (!suggestionPlaced) break;
    }
}
function hasReliableOpeningHours(hours) {
    return Boolean(hours?.periods?.length);
}
function toMealGapStops(stops) {
    return stops.map((s)=>({
            stopType: s.stopType,
            mealType: s.mealType ?? null,
            scheduledTime: s.scheduledTime,
            durationMinutes: s.durationMinutes,
            placeId: s.placeId,
            place: s.place ? {
                lat: s.place.lat,
                lng: s.place.lng,
                category: s.place.category,
                reservation_time: s.place.reservation_time,
                reservation_date: s.place.reservation_date,
                source: s.place.source,
                name: s.place.name
            } : null,
            suggestedPlace: s.suggestedPlace ? {
                lat: s.suggestedPlace.lat,
                lng: s.suggestedPlace.lng,
                category: s.suggestedPlace.category,
                name: s.suggestedPlace.name,
                openingHours: s.suggestedPlace.openingHours
            } : null
        }));
}
function toMealGapCandidates(candidates) {
    return candidates.map((c)=>({
            placeId: c.placeId,
            name: c.name,
            lat: c.lat,
            lng: c.lng,
            openingHours: c.openingHours ?? null
        }));
}
async function addMeal(ctx, stops, cursor, meal, date, reservedMeals, options) {
    if (reservedMeals.has(meal)) return true;
    if (!mealsEnabled()) return false;
    const relaxed = options?.relaxed ?? false;
    const window = MEAL_WINDOWS[meal];
    const windowEnd = relaxed ? window.end + 60 : window.end;
    if (!options?.allowAfterWindow && !relaxed && cursor.minutes > window.end) {
        const candidates = collectMealCandidates(ctx, meal, date);
        const gapResult = await tryInsertMealViaGaps({
            stops: toMealGapStops(stops),
            meal,
            date: ctx.date,
            hotel: ctx.hotel,
            dayEndMinutes: ctx.dayEndMinutes,
            candidates: toMealGapCandidates(candidates),
            travelTime: ctx.travelTime,
            usedGoogleIds: ctx.usedGoogleIds,
            usedMealBrands: ctx.usedMealBrandKeys,
            manualGoogleIds: ctx.manualGoogleIds,
            allowDuplicateBrand: options?.allowDuplicateBrand ?? relaxed,
            relaxed
        });
        if (gapResult.success && gapResult.candidate && gapResult.mealStart != null) {
            const mealSuggestion = candidates.find((c)=>c.placeId === gapResult.candidate.placeId) ?? candidates[0];
            if (mealSuggestion) {
                await pushStop(ctx, stops, {
                    minutes: gapResult.mealStart,
                    location: {
                        lat: mealSuggestion.lat,
                        lng: mealSuggestion.lng
                    }
                }, {
                    stopType: "meal",
                    suggestedPlace: mealSuggestion,
                    mealType: meal,
                    durationMinutes: window.duration,
                    suggestionKey: `${date}-${meal}-gap`,
                    isSuggested: true,
                    scheduledTime: minutesToTimeString(gapResult.mealStart)
                }, ctx.travelTime);
                reservedMeals.add(meal);
                registerMealInterest(ctx);
                return true;
            }
        }
        const rejections = emptyMealRejectionCounts();
        rejections.outsideMealWindow = 1;
        logMealNotPlaced({
            phase: options?.logContext ?? "addMeal",
            date,
            meal,
            candidateCount: candidates.length,
            rejections,
            reason: "cursor_past_window",
        });
        return false;
    }
    const candidates = collectMealCandidates(ctx, meal, date);
    const rejections = emptyMealRejectionCounts();
    if (candidates.length === 0) {
        rejections.noCandidates = 1;
        logMealNotPlaced({
            phase: options?.logContext ?? "addMeal",
            date,
            meal,
            candidateCount: 0,
            rejections,
        });
        return false;
    }
    const allowBrandDup = options?.allowDuplicateBrand ?? relaxed;
    const isValidMeal = (candidate)=>{
        if (candidate.experience) return false;
        if (ctx.manualGoogleIds.has(candidate.placeId)) return false;
        if (!relaxed && !isSitDownRestaurant(candidate.name)) return false;
        if (relaxed && isExperienceActivity([], candidate.name)) return false;
        return true;
    };

    for (const mealSuggestion of candidates) {
        if (ctx.usedGoogleIds.has(mealSuggestion.placeId)) {
            rejections.usedGoogleId++;
            continue;
        }
        if (!allowBrandDup && isRestaurantBrandUsed(mealSuggestion.name, ctx.usedMealBrandKeys)) {
            rejections.duplicateBrand++;
            continue;
        }
        if (ctx.manualGoogleIds.has(mealSuggestion.placeId)) {
            rejections.manualPlaceExcluded++;
            continue;
        }
        if (!isValidMeal(mealSuggestion)) {
            rejections.invalidMealCandidate++;
            continue;
        }

        const travel = await ctx.travelTime(cursor.location, {
            lat: mealSuggestion.lat,
            lng: mealSuggestion.lng
        });
        let latestStart = options?.allowAfterWindow || relaxed ? windowEnd + (relaxed ? 30 : 0) : window.end;
        if (options?.latestStart != null) {
            latestStart = Math.min(latestStart, options.latestStart);
        }
        latestStart = Math.min(latestStart, ctx.dayEndMinutes - window.duration);

        let start = Math.max(cursor.minutes + travel, window.start);
        if (options?.notBefore != null) {
            start = Math.max(start, options.notBefore);
        }
        if (!relaxed) {
            start = Math.max(start, getMealEarliestMinutes(meal, ctx.date, mealSuggestion.openingHours));
        }

        let adjusted = adjustStartForOpeningHours(
            ctx.date,
            start,
            window.duration,
            "restaurant",
            mealSuggestion.openingHours,
            latestStart
        );
        if (adjusted == null) {
            if (relaxed && !hasReliableOpeningHours(mealSuggestion.openingHours)) {
                adjusted = Math.min(Math.max(start, window.start), latestStart);
            } else {
                rejections.closedOrHoursFailed++;
                continue;
            }
        }
        start = Math.max(
            adjusted,
            relaxed ? window.start : getMealEarliestMinutes(meal, ctx.date, mealSuggestion.openingHours)
        );
        if (options?.latestStart != null && start > options.latestStart) {
            rejections.deadlineOrDayEndFailed++;
            continue;
        }
        if (start > latestStart) {
            rejections.outsideMealWindow++;
            continue;
        }
        if (start + window.duration > ctx.dayEndMinutes) {
            rejections.deadlineOrDayEndFailed++;
            continue;
        }

        await pushStop(ctx, stops, cursor, {
            stopType: "meal",
            suggestedPlace: mealSuggestion,
            mealType: meal,
            durationMinutes: window.duration,
            suggestionKey: `${date}-${meal}${relaxed ? "-relaxed" : ""}`,
            isSuggested: true,
            scheduledTime: minutesToTimeString(start)
        }, ctx.travelTime);
        reservedMeals.add(meal);
        registerMealInterest(ctx);
        return true;
    }

    logMealNotPlaced({
        phase: options?.logContext ?? "addMeal",
        date,
        meal,
        candidateCount: candidates.length,
        rejections,
        mode: relaxed ? "relaxed" : undefined,
    });
    return false;
}
async function addBreakfastAfterMorningAnchor(ctx, stops, cursor, date, reservedMeals, anchorPlace) {
    if (reservedMeals.has("breakfast") || stops.some((s)=>s.mealType === "breakfast")) return;
    const anchorEnd =
        parseReservationMinutes(anchorPlace.reservation_time) +
        getDefaultVisitMinutes(anchorPlace.category);
    const brunchStart = Math.max(anchorEnd + 15, MEAL_WINDOWS.breakfast.start);
    await addMeal(ctx, stops, {
        minutes: brunchStart,
        location: {
            lat: anchorPlace.lat,
            lng: anchorPlace.lng
        }
    }, "breakfast", date, reservedMeals, {
        allowAfterWindow: true,
        notBefore: brunchStart
    });
}
async function addMealAtTime(ctx, stops, cursor, meal, date, reservedMeals, startMinutes, beforeAnchorPlace) {
    if (reservedMeals.has(meal)) return true;
    if (!mealsEnabled()) return false;
    const window = MEAL_WINDOWS[meal];
    const activityLocs = getActivityLocations(stops);
    const searchAt = getMealSearchLocation(meal, ctx.hotel, activityLocs);
    const candidates = [];
    const rejections = emptyMealRejectionCounts();
    const prefetched = ctx.mealSuggestions.get(`${date}-${meal}`);
    if (prefetched && !ctx.usedGoogleIds.has(prefetched.placeId)) candidates.push(prefetched);
    for (const [slotKey, candidate] of ctx.mealSuggestions){
        if (!slotKey.endsWith(`-${meal}`)) continue;
        if (ctx.usedGoogleIds.has(candidate.placeId)) continue;
        if (!candidates.some((c)=>c.placeId === candidate.placeId)) candidates.push(candidate);
    }
    const fallback = pickMealSuggestion(ctx, searchAt, meal, date, startMinutes);
    if (fallback && !candidates.some((c)=>c.placeId === fallback.placeId)) candidates.push(fallback);
    if (candidates.length === 0) {
        rejections.noCandidates = 1;
        logMealNotPlaced({
            phase: "addMealAtTime",
            date,
            meal,
            candidateCount: 0,
            rejections,
        });
        return false;
    }
    for (const candidate of candidates){
        if (ctx.usedGoogleIds.has(candidate.placeId)) {
            rejections.usedGoogleId++;
            continue;
        }
        if (isRestaurantBrandUsed(candidate.name, ctx.usedMealBrandKeys)) {
            rejections.duplicateBrand++;
            continue;
        }
        if (!isSitDownRestaurant(candidate.name) || candidate.experience) {
            rejections.invalidMealCandidate++;
            continue;
        }
        const travel = await ctx.travelTime(ctx.hotel, {
            lat: candidate.lat,
            lng: candidate.lng
        });
        let latestStart = window.end;
        if (beforeAnchorPlace?.reservation_time) {
            const anchorMinutes = parseReservationMinutes(beforeAnchorPlace.reservation_time);
            const travelToAnchor = await ctx.travelTime({
                lat: candidate.lat,
                lng: candidate.lng
            }, {
                lat: beforeAnchorPlace.lat,
                lng: beforeAnchorPlace.lng
            });
            latestStart = Math.min(latestStart, anchorMinutes - travelToAnchor - window.duration);
        }
        let start = startMinutes + travel;
        const adjusted = adjustStartForOpeningHours(
            ctx.date,
            start,
            window.duration,
            "restaurant",
            candidate.openingHours,
            latestStart
        );
        if (adjusted == null) {
            rejections.closedOrHoursFailed++;
            continue;
        }
        start = adjusted;
        if (beforeAnchorPlace?.reservation_time) {
            const anchorMinutes = parseReservationMinutes(beforeAnchorPlace.reservation_time);
            const travelToAnchor = await ctx.travelTime({
                lat: candidate.lat,
                lng: candidate.lng
            }, {
                lat: beforeAnchorPlace.lat,
                lng: beforeAnchorPlace.lng
            });
            if (start + window.duration + travelToAnchor > anchorMinutes) {
                rejections.deadlineOrDayEndFailed++;
                continue;
            }
        }
        cursor.minutes = startMinutes;
        cursor.location = ctx.hotel;
        await pushStop(ctx, stops, cursor, {
            stopType: "meal",
            suggestedPlace: candidate,
            mealType: meal,
            durationMinutes: window.duration,
            suggestionKey: `${date}-${meal}-early`,
            isSuggested: true,
            scheduledTime: minutesToTimeString(start)
        }, ctx.travelTime);
        reservedMeals.add(meal);
        registerMealInterest(ctx);
        return true;
    }
    logMealNotPlaced({
        phase: "addMealAtTime",
        date,
        meal,
        candidateCount: candidates.length,
        rejections,
    });
    return false;
}

async function scheduleManualPlacesForDay(ctx, stops, cursor, manualToday, deadlineMinutes) {
    for (const place of manualToday) {
        if (ctx.usedPlaceIds.has(place.id)) continue;
        if (place.google_place_id && ctx.usedGoogleIds.has(place.google_place_id)) {
            evictSuggestedGoogleDuplicate(stops, place.google_place_id);
        }
        const duration = excursionVisitMinutes(ctx.hotel, place, getDefaultVisitMinutes(place.category));
        const travel = await ctx.travelTime(cursor.location, {
            lat: place.lat,
            lng: place.lng
        });
        let start = cursor.minutes + travel;
        let adjusted = adjustStartForOpeningHours(
            ctx.date,
            start,
            duration,
            place.category,
            place.opening_hours,
            deadlineMinutes - duration
        );
        if (adjusted == null) {
            adjusted = getEarliestOpenMinutes(ctx.date, place.category, place.opening_hours);
        }
        if (adjusted + duration > deadlineMinutes || adjusted + duration > ctx.dayEndMinutes) continue;
        start = adjusted;
        await pushStop(ctx, stops, cursor, {
            stopType: "place",
            placeId: place.id,
            place,
            durationMinutes: duration,
            isSuggested: false,
            scheduledTime: minutesToTimeString(start)
        }, ctx.travelTime);
        registerPlaceInterests(ctx, place);
    }
}
async function ensureTripManualPlacesScheduled(ctx, days, manualPlaces, dates, reservedByDate) {
    const unscheduled = manualPlaces.filter((p) => !ctx.usedPlaceIds.has(p.id));
    for (const place of unscheduled) {
        if (place.google_place_id && ctx.usedGoogleIds.has(place.google_place_id)) {
            for (const day of days){
                evictSuggestedGoogleDuplicate(day.stops, place.google_place_id);
            }
        }
        let bestIdx = 0;
        for (let i = 1; i < days.length; i++) {
            if (days[i].stops.length < days[bestIdx].stops.length) bestIdx = i;
        }
        const date = dates[bestIdx];
        const day = days[bestIdx];
        ctx.date = date;
        ctx.dayThemes.clear();
        ctx.dayInterests.clear();
        const cursor = cursorFromStops(day.stops, ctx.hotel, ctx.dayStartMinutes);
        const duration = excursionVisitMinutes(ctx.hotel, place, getDefaultVisitMinutes(place.category));
        let start = Math.max(cursor.minutes, getEarliestOpenMinutes(date, place.category, place.opening_hours));
        if (start + duration > ctx.dayEndMinutes) start = Math.max(ctx.dayStartMinutes, ctx.dayEndMinutes - duration - 30);
        await pushStop(ctx, day.stops, cursor, {
            stopType: "place",
            placeId: place.id,
            place,
            durationMinutes: duration,
            isSuggested: false,
            scheduledTime: minutesToTimeString(start)
        }, ctx.travelTime);
        registerPlaceInterests(ctx, place);
        day.stops = finalizeDayTimes(day.stops, ctx, reservedByDate.get(date) ?? [], date);
    }
}
async function insertReservations(ctx, stops, cursor, reservedToday) {
    const anchors = reservedToday.filter((p)=>p.reservation_time).sort((a, b)=>parseReservationMinutes(a.reservation_time) - parseReservationMinutes(b.reservation_time));
    for (const place of anchors){
        if (ctx.usedPlaceIds.has(place.id)) continue;
        const anchorTime = parseReservationMinutes(place.reservation_time);
        let mealType = null;
        if (place.category === "restaurant") {
            if (isMealAppropriateTime("breakfast", anchorTime)) mealType = "breakfast";
            else if (isMealAppropriateTime("lunch", anchorTime)) mealType = "lunch";
            else if (isMealAppropriateTime("dinner", anchorTime)) mealType = "dinner";
        }
        await pushStop(ctx, stops, cursor, {
            stopType: mealType ? "meal" : "place",
            placeId: place.id,
            place,
            mealType,
            durationMinutes: excursionVisitMinutes(ctx.hotel, place, getDefaultVisitMinutes(place.category)),
            scheduledTime: minutesToTimeString(anchorTime),
            isSuggested: place.source === "suggested"
        }, ctx.travelTime);
        ctx.usedPlaceIds.add(place.id);
        registerPlaceInterests(ctx, place);
    }
}
function detectReservedMeals(reservedToday) {
    const meals = new Set();
    for (const place of reservedToday){
        if (place.category !== "restaurant" || !place.reservation_time) continue;
        const mins = parseReservationMinutes(place.reservation_time);
        if (isMealAppropriateTime("breakfast", mins)) meals.add("breakfast");
        if (isMealAppropriateTime("lunch", mins)) meals.add("lunch");
        if (isMealAppropriateTime("dinner", mins)) meals.add("dinner");
    }
    return meals;
}
function cursorFromStops(stops, hotel, dayStartMinutes) {
    if (stops.length === 0) {
        return {
            minutes: dayStartMinutes,
            location: hotel
        };
    }
    const last = stops[stops.length - 1];
    const endMinutes = parseReservationMinutes(last.scheduledTime) + last.durationMinutes;
    const location = last.place ? {
        lat: last.place.lat,
        lng: last.place.lng
    } : last.suggestedPlace ? {
        lat: last.suggestedPlace.lat,
        lng: last.suggestedPlace.lng
    } : hotel;
    return {
        minutes: endMinutes,
        location
    };
}
function countSightseeingStops(stops) {
    return stops.filter((s)=>{
        if (s.mealType || s.stopType === "meal") return false;
        const cat = s.place?.category ?? s.suggestedPlace?.category;
        return cat === "monument" || cat === "museum" || cat === "activity";
    }).length;
}
async function topUpSparseDay(ctx, stops, date, reservedMeals, reservedToday, options) {
    const MIN_STOPS = 5;
    const categories = activityCategoriesForInterests(ctx.interests);
    let cursor = cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes);
    const missingMeals = [
        "breakfast",
        "lunch",
        "dinner"
    ].filter((meal)=>!options?.skipMeals?.includes(meal) && !reservedMeals.has(meal) && !stops.some((s)=>s.mealType === meal));
    for (const meal of missingMeals){
        if (!mealsEnabled()) continue;
        const window = MEAL_WINDOWS[meal];
        const activityLocs = getActivityLocations(stops);
        const searchAt = getMealSearchLocation(meal, ctx.hotel, activityLocs);
        const mealSuggestion = pickMealSuggestion(ctx, searchAt, meal, date, window.start);
        if (mealSuggestion) {
            if (cursor.minutes > window.end) {
                await pushStop(ctx, stops, {
                    minutes: window.start,
                    location: ctx.hotel
                }, {
                    stopType: "meal",
                    suggestedPlace: mealSuggestion,
                    mealType: meal,
                    durationMinutes: window.duration,
                    suggestionKey: `${date}-${meal}`,
                    isSuggested: true
                }, ctx.travelTime);
                reservedMeals.add(meal);
                registerMealInterest(ctx);
            } else {
                const mealCursor = {
                    minutes: Math.max(cursor.minutes, window.start),
                    location: cursor.location
                };
                await addMeal(ctx, stops, mealCursor, meal, date, reservedMeals, {
                    logContext: "topUpSparseDay"
                });
            }
        } else {
            const poolCandidates = collectMealCandidates(ctx, meal, date);
            logMealNotPlaced({
                phase: "topUpSparseDay_pick",
                date,
                meal,
                candidateCount: poolCandidates.length,
                rejections: {
                    ...emptyMealRejectionCounts(),
                    noCandidates: poolCandidates.length === 0 ? 1 : 0,
                },
                reason: "pickMealSuggestion_null",
            });
            const mealCursor = {
                minutes: Math.max(cursor.minutes, window.start),
                location: cursor.location
            };
            let placed = await addMeal(ctx, stops, mealCursor, meal, date, reservedMeals, {
                logContext: "topUpSparseDay_fallback"
            });
            if (!placed) {
                await addMeal(ctx, stops, mealCursor, meal, date, reservedMeals, {
                    allowAfterWindow: true,
                    relaxed: true,
                    allowDuplicateBrand: true,
                    logContext: "topUpSparseDay_relaxed"
                });
            }
        }
        cursor = cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes);
    }
    let attempts = 0;
    let consecutiveFailures = 0;
    const activityDeadline = Math.min(MEAL_WINDOWS.dinner.start - 15, ctx.dayEndMinutes - 45);
    while(
        (stops.length < MIN_STOPS || countSightseeingStops(stops) < 2) &&
        cursor.minutes + 45 < activityDeadline &&
        attempts++ < 15 &&
        consecutiveFailures < 3
    ){
        const before = stops.length;
        const beforeSightseeing = countSightseeingStops(stops);
        await addActivities(ctx, stops, cursor, [], categories, 1, activityDeadline);
        cursor = cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes);
        if (stops.length === before && countSightseeingStops(stops) === beforeSightseeing) {
            consecutiveFailures++;
        } else {
            consecutiveFailures = 0;
        }
    }
    const hasAllMeals = [
        "breakfast",
        "lunch",
        "dinner"
    ].every((meal)=>reservedMeals.has(meal) || stops.some((s)=>s.mealType === meal));
    if (hasAllMeals && ctx.interests.includes("bars_nightlife") && stops.length < MIN_STOPS) {
        cursor = cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes);
        const eveningStart = Math.max(MEAL_WINDOWS.dinner.end, getCategoryEarliestOpen("bar"));
        if (cursor.minutes < ctx.dayEndMinutes) {
            cursor.minutes = Math.max(cursor.minutes, eveningStart);
            const night = pickSuggestion(ctx, cursor.location, EVENING_CATEGORIES, cursor.minutes);
            if (night) {
                await pushStop(ctx, stops, cursor, {
                    stopType: "place",
                    suggestedPlace: night,
                    durationMinutes: getDefaultVisitMinutes(night.category),
                    suggestionKey: `${date}-evening-topup`,
                    isSuggested: true
                }, ctx.travelTime);
            }
        }
    }
}
async function ensureRequiredMeals(ctx, stops, date, reservedMeals, reservedToday, options) {
    if (!mealsEnabled()) return;
    for (const meal of dayMissingMeals(stops, reservedMeals)){
        if (reservedMeals.has(meal)) continue;
        if (options?.skipMeals?.includes(meal)) continue;
        const window = MEAL_WINDOWS[meal];
        const mealCursor = meal === "breakfast"
            ? { minutes: window.start, location: ctx.hotel }
            : meal === "lunch"
            ? { minutes: window.start, location: cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes).location }
            : { minutes: window.start, location: ctx.hotel };
        let placed = await addMeal(ctx, stops, mealCursor, meal, date, reservedMeals, {
            allowAfterWindow: meal === "breakfast",
            logContext: "ensureRequiredMeals"
        });
        if (!placed) {
            await addMeal(ctx, stops, mealCursor, meal, date, reservedMeals, {
                allowAfterWindow: true,
                relaxed: true,
                allowDuplicateBrand: true,
                logContext: "ensureRequiredMeals_relaxed"
            });
        }
    }
    stops.splice(0, stops.length, ...sortDayStopsByRhythm(stops, reservedToday ?? [], date));
}
function dayHasExcursion(hotel, unreservedToday, reservedToday) {
    return unreservedToday.some((p)=>isExcursionPlace(hotel, p)) || reservedToday.some((p)=>isExcursionPlace(hotel, p));
}
async function scheduleExcursionDay(ctx, dayNumber, date, manualToday, reservedToday) {
    ctx.date = date;
    ctx.dayThemes.clear();
    ctx.dayInterests.clear();
    const stops = [];
    const cursor = {
        minutes: ctx.dayStartMinutes,
        location: ctx.hotel
    };
    const reservedMeals = detectReservedMeals(reservedToday);
    const { excursion: excursionPlaces } = splitByExcursionDistance(ctx.hotel, manualToday);
    const excursionReservations = reservedToday.filter((p)=>isExcursionPlace(ctx.hotel, p));
    const localReservations = reservedToday.filter((p)=>!isExcursionPlace(ctx.hotel, p));
    const dinnerDeadline = MEAL_WINDOWS.dinner.start - 15;
    const eveningStart = Math.max(MEAL_WINDOWS.dinner.end, getCategoryEarliestOpen("bar"));
    const categories = activityCategoriesForInterests(ctx.interests);
    const earliestExcursionMinutes = excursionReservations.map((p)=>parseReservationMinutes(p.reservation_time)).sort((a, b)=>a - b)[0];
    // Early pickup (e.g. 7 AM car to Montserrat) — quick breakfast before departure.
    if (earliestExcursionMinutes != null && earliestExcursionMinutes < MEAL_WINDOWS.breakfast.start && !reservedMeals.has("breakfast")) {
        const breakfastAt = Math.max(6 * 60, earliestExcursionMinutes - MEAL_WINDOWS.breakfast.duration - 15);
        if (breakfastAt + MEAL_WINDOWS.breakfast.duration <= earliestExcursionMinutes) {
            await addMealAtTime(ctx, stops, cursor, "breakfast", date, reservedMeals, breakfastAt);
        }
    } else if (earliestExcursionMinutes == null || earliestExcursionMinutes >= MEAL_WINDOWS.breakfast.start) {
        await addMeal(ctx, stops, cursor, "breakfast", date, reservedMeals);
    }
    const localMorningRes = localReservations.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) < MEAL_WINDOWS.lunch.start);
    await insertReservations(ctx, stops, cursor, localMorningRes);
    await scheduleManualPlacesForDay(ctx, stops, cursor, manualToday, dinnerDeadline);
    await insertReservations(ctx, stops, cursor, excursionReservations);
    const hasExcursionStop = stops.some((s)=>s.stopType === "place" && (s.place ? isExcursionPlace(ctx.hotel, s.place) : s.suggestedPlace ? isExcursionPlace(ctx.hotel, s.suggestedPlace) : false));
    if (!hasExcursionStop && excursionPlaces.length > 0) {
        await addActivities(ctx, stops, cursor, excursionPlaces, categories, 1, ctx.dayEndMinutes - 45);
    }
    cursor.minutes = Math.max(cursor.minutes, MEAL_WINDOWS.lunch.start);
    await addMeal(ctx, stops, cursor, "lunch", date, reservedMeals, {
        allowAfterWindow: true
    });
    const localAfternoonRes = localReservations.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) >= MEAL_WINDOWS.lunch.start && parseReservationMinutes(p.reservation_time) < MEAL_WINDOWS.dinner.end);
    await insertReservations(ctx, stops, cursor, localAfternoonRes);
    cursor.minutes = Math.max(cursor.minutes, MEAL_WINDOWS.dinner.start);
    await addMeal(ctx, stops, cursor, "dinner", date, reservedMeals);
    const nightReservations = localReservations.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) >= MEAL_WINDOWS.dinner.start);
    await insertReservations(ctx, stops, cursor, nightReservations);
    if (ctx.interests.includes("bars_nightlife") && cursor.minutes < ctx.dayEndMinutes) {
        cursor.minutes = Math.max(cursor.minutes, eveningStart);
        let eveningCount = 0;
        while(eveningCount < 2 && cursor.minutes + 45 < ctx.dayEndMinutes){
            const night = pickSuggestion(ctx, cursor.location, EVENING_CATEGORIES, cursor.minutes);
            if (!night) break;
            await pushStop(ctx, stops, cursor, {
                stopType: "place",
                suggestedPlace: night,
                durationMinutes: getDefaultVisitMinutes(night.category),
                suggestionKey: `${date}-evening-${eveningCount}`,
                isSuggested: true
            }, ctx.travelTime);
            registerSuggestionInterests(ctx, night);
            eveningCount++;
        }
    }
    const skipBreakfastAfterEarlyDeparture = earliestExcursionMinutes != null && earliestExcursionMinutes < MEAL_WINDOWS.breakfast.start && !stops.some((s)=>s.mealType === "breakfast");
    const skipMeals = skipBreakfastAfterEarlyDeparture ? [
        "breakfast"
    ] : undefined;
    await ensureRequiredMeals(ctx, stops, date, reservedMeals, reservedToday, {
        skipMeals
    });
    await topUpSparseDay(ctx, stops, date, reservedMeals, reservedToday, {
        skipMeals
    });
    const deduped = dedupeStopsPreferManual(stops);
    const rhythmOrdered = sortDayStopsByRhythm(deduped, reservedToday, date);
    return {
        dayNumber,
        date,
        stops: finalizeDayTimes(rhythmOrdered, ctx, reservedToday, date)
    };
}
async function scheduleDay(ctx, dayNumber, date, manualToday, reservedToday) {
    ctx.dayUsedPlaceIds.clear();
    ctx.dayUsedGoogleIds.clear();
    if (dayHasExcursion(ctx.hotel, manualToday, reservedToday)) {
        return scheduleExcursionDay(ctx, dayNumber, date, manualToday, reservedToday);
    }
    return scheduleStandardDay(ctx, dayNumber, date, manualToday, reservedToday);
}
function dayHasSightseeing(stops) {
    return stops.some((s)=>{
        if (s.stopType === "meal") return false;
        const cat = s.place?.category ?? s.suggestedPlace?.category;
        return cat === "monument" || cat === "museum" || cat === "activity";
    });
}
async function ensureSightseeingStop(ctx, stops, date, deadlineMinutes) {
    const selectedActivityInterests = ACTIVITY_SLOT_INTERESTS.filter((i)=>ctx.interests.includes(i));
    const missingInterests = selectedActivityInterests.filter((i)=>!ctx.dayInterests.has(i));
    if (selectedActivityInterests.length > 0) {
        if (missingInterests.length === 0) return;
    } else if (dayHasSightseeing(stops)) {
        return;
    }
    const cursor = cursorFromStops(stops, ctx.hotel, ctx.dayStartMinutes);
    if (cursor.minutes + 45 >= deadlineMinutes) return;
    const categories = activityCategoriesForInterests(ctx.interests);
    const pick = pickBalancedActivitySuggestion(ctx, cursor.location, categories, cursor.minutes + 10, stops.filter((s)=>s.stopType !== "meal").length);
    if (!pick) return;
    await pushStop(ctx, stops, cursor, {
        stopType: "place",
        suggestedPlace: pick,
        durationMinutes: getDefaultVisitMinutes(pick.category),
        suggestionKey: `${date}-sightseeing`,
        isSuggested: true
    }, ctx.travelTime);
    registerSuggestionInterests(ctx, pick);
}
async function scheduleStandardDay(ctx, dayNumber, date, manualToday, reservedToday) {
    ctx.date = date;
    ctx.dayThemes.clear();
    ctx.dayInterests.clear();
    const stops = [];
    const cursor = {
        minutes: ctx.dayStartMinutes,
        location: ctx.hotel
    };
    const reservedMeals = detectReservedMeals(reservedToday);
    const lunchDeadline = MEAL_WINDOWS.lunch.start - 15;
    const dinnerDeadline = MEAL_WINDOWS.dinner.start - 15;
    const eveningStart = Math.max(MEAL_WINDOWS.dinner.end, getCategoryEarliestOpen("bar"));
    const morningReservations = reservedToday.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) < MEAL_WINDOWS.lunch.start);
    const earliestMorningMinutes = morningReservations.map((p)=>parseReservationMinutes(p.reservation_time)).sort((a, b)=>a - b)[0];
    const firstMorningReservation = morningReservations.find((p)=>parseReservationMinutes(p.reservation_time) === earliestMorningMinutes);
    if (earliestMorningMinutes != null && !reservedMeals.has("breakfast")) {
        const breakfastAt = Math.max(6 * 60, earliestMorningMinutes - MEAL_WINDOWS.breakfast.duration - 25);
        if (breakfastAt + MEAL_WINDOWS.breakfast.duration <= earliestMorningMinutes - 10) {
            await addMealAtTime(ctx, stops, cursor, "breakfast", date, reservedMeals, breakfastAt, firstMorningReservation);
        } else {
            await addMeal(ctx, stops, cursor, "breakfast", date, reservedMeals);
        }
    } else if (!reservedMeals.has("breakfast")) {
        await addMeal(ctx, stops, cursor, "breakfast", date, reservedMeals);
    }
    await insertReservations(ctx, stops, cursor, morningReservations);
    if (!stops.some((s)=>s.mealType === "breakfast") && !reservedMeals.has("breakfast") && firstMorningReservation) {
        await addBreakfastAfterMorningAnchor(ctx, stops, cursor, date, reservedMeals, firstMorningReservation);
    }
    await scheduleManualPlacesForDay(ctx, stops, cursor, manualToday, lunchDeadline);
    await addActivities(ctx, stops, cursor, [], activityCategoriesForInterests(ctx.interests), 2, lunchDeadline);
    cursor.minutes = Math.max(cursor.minutes, MEAL_WINDOWS.lunch.start);
    await addMeal(ctx, stops, cursor, "lunch", date, reservedMeals);
    const laterReservations = reservedToday.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) >= MEAL_WINDOWS.lunch.start && parseReservationMinutes(p.reservation_time) < MEAL_WINDOWS.dinner.end);
    await insertReservations(ctx, stops, cursor, laterReservations);
    await scheduleManualPlacesForDay(ctx, stops, cursor, manualToday.filter((p) => !ctx.usedPlaceIds.has(p.id)), dinnerDeadline);
    await addActivities(ctx, stops, cursor, [], activityCategoriesForInterests(ctx.interests), 2, dinnerDeadline);
    await ensureSightseeingStop(ctx, stops, date, dinnerDeadline);
    cursor.minutes = Math.max(cursor.minutes, MEAL_WINDOWS.dinner.start);
    await addMeal(ctx, stops, cursor, "dinner", date, reservedMeals);
    const nightReservations = reservedToday.filter((p)=>p.reservation_time && parseReservationMinutes(p.reservation_time) >= MEAL_WINDOWS.dinner.start);
    await insertReservations(ctx, stops, cursor, nightReservations);
    if (ctx.interests.includes("bars_nightlife") && cursor.minutes < ctx.dayEndMinutes) {
        cursor.minutes = Math.max(cursor.minutes, eveningStart);
        let eveningCount = 0;
        while(eveningCount < 2 && cursor.minutes + 45 < ctx.dayEndMinutes){
            const night = pickSuggestion(ctx, cursor.location, EVENING_CATEGORIES, cursor.minutes);
            if (!night) break;
            await pushStop(ctx, stops, cursor, {
                stopType: "place",
                suggestedPlace: night,
                durationMinutes: getDefaultVisitMinutes(night.category),
                suggestionKey: `${date}-evening-${eveningCount}`,
                isSuggested: true
            }, ctx.travelTime);
            registerSuggestionInterests(ctx, night);
            eveningCount++;
        }
    }
    if (stops.length === 0) {
        const fallback = pickSuggestion(ctx, ctx.hotel, activityCategoriesForInterests(ctx.interests), ctx.dayStartMinutes + 60);
        if (fallback) {
            await pushStop(ctx, stops, {
                minutes: ctx.dayStartMinutes + 60,
                location: ctx.hotel
            }, {
                stopType: "place",
                suggestedPlace: fallback,
                durationMinutes: getDefaultVisitMinutes(fallback.category),
                isSuggested: true
            }, ctx.travelTime);
        }
    }
    await ensureRequiredMeals(ctx, stops, date, reservedMeals, reservedToday);
    await topUpSparseDay(ctx, stops, date, reservedMeals, reservedToday);
    const deduped = dedupeStopsPreferManual(stops);
    const rhythmOrdered = sortDayStopsByRhythm(deduped, reservedToday, date);
    return {
        dayNumber,
        date,
        stops: finalizeDayTimes(rhythmOrdered, ctx, reservedToday, date)
    };
}
function toRhythmShape(stop, reservedToday, date) {
    const reservedPlace = stop.placeId ? reservedToday.find((p)=>p.id === stop.placeId) : stop.place;
    const place = stop.place ?? stop.suggestedPlace;
    return {
        stop_type: stop.stopType,
        meal_type: stop.mealType ?? null,
        scheduled_time: stop.scheduledTime,
        place: place ? {
            category: place.category,
            reservation_time: reservedPlace?.reservation_time ?? null
        } : null,
        anchor_time: reservedPlace?.reservation_time && reservedPlace.reservation_date === date ? reservedPlace.reservation_time : null
    };
}
function sortDayStopsByRhythm(stops, reservedToday, date) {
    return [
        ...stops
    ].sort((a, b)=>compareStopsByDayRhythm(toRhythmShape(a, reservedToday, date), toRhythmShape(b, reservedToday, date)));
}
function finalizeDayTimes(stops, ctx, reservedToday, date) {
    const sorted = sortDayStopsByRhythm(stops, reservedToday, date);
    const scheduleStops = sorted.map((stop)=>{
        const reservedPlace = stop.placeId ? reservedToday.find((p)=>p.id === stop.placeId) : stop.place;
        const anchorTime = reservedPlace?.reservation_time && reservedPlace.reservation_date === date ? reservedPlace.reservation_time : null;
        return {
            stop_type: stop.stopType,
            meal_type: stop.mealType ?? null,
            duration_minutes: stop.durationMinutes,
            scheduled_time: stop.scheduledTime,
            place: stop.place ? {
                lat: stop.place.lat,
                lng: stop.place.lng,
                category: stop.place.category,
                name: stop.place.name
            } : stop.suggestedPlace ? {
                lat: stop.suggestedPlace.lat,
                lng: stop.suggestedPlace.lng,
                category: stop.suggestedPlace.category,
                name: stop.suggestedPlace.name
            } : null,
            opening_hours: stop.place?.opening_hours ?? stop.suggestedPlace?.openingHours ?? null,
            anchor_time: anchorTime
        };
    });
    const times = recomputeScheduleTimes(scheduleStops, ctx.hotel, ctx.dayStartMinutes, date);
    const recomputed = sorted.map((stop, i)=>{
        const anchor = scheduleStops[i].anchor_time;
        return {
            ...stop,
            scheduledTime: anchor ? anchor.slice(0, 8).length === 5 ? `${anchor.slice(0, 5)}:00` : anchor.slice(0, 8) : times[i].scheduled_time
        };
    });
    return sortDayStopsByRhythm(recomputed, reservedToday, date);
}
export async function generateSmartItinerary(input) {
    const { places, dates, hotel, interests, travelTime, dayStartTime, dayEndTime, suggestionPool, mealSuggestions } = input;
    const { dayStartMinutes, dayEndMinutes } = parseSchedulerDayBounds(dayStartTime, dayEndTime);
    const manualPlaces = getManualPlaces(places);
    const manualGoogleIds = googlePlaceIdsForManualPlaces(manualPlaces);
    const manualByDay = assignManualPlacesToDays(manualPlaces, dates);
    const ctx = {
        date: "",
        hotel,
        interests,
        travelTime,
        dayStartMinutes,
        dayEndMinutes,
        usedPlaceIds: new Set(),
        usedGoogleIds: new Set(),
        usedMealBrandKeys: new Set(),
        savedGoogleIds: new Set(manualGoogleIds),
        manualGoogleIds,
        dayUsedPlaceIds: new Set(),
        dayUsedGoogleIds: new Set(),
        dayThemes: new Set(),
        dayInterests: new Set(),
        tripInterestCounts: initTripInterestCounts(interests),
        suggestionPool: suggestionPool.map((r) => toSuggestedInput(r)),
        mealSuggestions: new Map([
            ...mealSuggestions.entries()
        ].map(([k, v]) => [
                k,
                toSuggestedInput(v)
            ]))
    };
    const reservedByDate = new Map();
    for (const date of dates) reservedByDate.set(date, []);
    for (const place of places) {
        if (placeHasReservation(place) && place.reservation_date && dates.includes(place.reservation_date)) {
            reservedByDate.get(place.reservation_date).push(place);
        }
    }
    const days = [];
    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const day = await scheduleDay(ctx, i + 1, date, manualByDay.get(date) ?? [], reservedByDate.get(date) ?? []);
        logDayScheduleDiagnostics(day.dayNumber, day.date, day.stops);
        days.push(day);
    }
    await ensureTripManualPlacesScheduled(ctx, days, manualPlaces, dates, reservedByDate);
    for (const day of days) {
        logDayScheduleDiagnostics(day.dayNumber, day.date, day.stops);
    }
    const totalStops = days.reduce((sum, day) => sum + day.stops.length, 0);
    logGenerateResult(
        days.map((d) => ({
            dayNumber: d.dayNumber,
            date: d.date,
            stopCount: d.stops.length
        })),
        totalStops
    );
    return days;
}