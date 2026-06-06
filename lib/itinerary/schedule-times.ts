import type { LatLng, PlaceCategory } from "@/lib/types";
import { isExperienceActivity, isParkOrNaturePlace } from "@/lib/types";
import { haversineDistance } from "@/lib/itinerary/generate";
import { EXCURSION_DISTANCE_KM } from "@/lib/itinerary/meal-locations";
import {
  compareStopsByDayRhythm,
  minutesAfterPriorMorningAnchors,
  nextAnchoredStopAfter,
} from "@/lib/itinerary/day-rhythm";
import {
  adjustStartForOpeningHours,
  getCategoryEarliestOpen,
  getCategoryLatestOpen,
  getDefaultVisitMinutes,
  getMealEarliestMinutes,
  MEAL_WINDOWS,
  minutesToTimeString,
  resolveMealArrivalMinutes,
  resolveVisitArrivalMinutes,
  type MealType,
  type OpeningHours,
} from "@/lib/itinerary/hours";

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minimum gap after a meal ends before the next meal-classified stop (mirrors meal-slots). */
const MEAL_ACTIVITY_GAP = 30;

function isMealClassifiedStop(stop: ScheduleTimeStop): boolean {
  return Boolean(
    stop.meal_type ||
      stop.stop_type === "meal" ||
      stop.place?.category === "restaurant"
  );
}

function isLateNightCategory(category: PlaceCategory): boolean {
  return category === "bar" || category === "nightlife";
}

function sightseeingLatestStartMinutes(
  dateStr: string,
  category: PlaceCategory,
  duration: number,
  hours?: OpeningHours | null,
  options?: { outdoor?: boolean; experience?: boolean }
): number {
  let latestStart = getCategoryLatestOpen(category) - duration;
  if (options?.outdoor) {
    latestStart = Math.min(latestStart, 18 * 60 - duration);
  } else if (options?.experience) {
    latestStart = Math.min(latestStart, 18 * 60 + 30 - duration);
  } else {
    latestStart = Math.min(latestStart, getCategoryLatestOpen(category) - duration);
  }
  return latestStart;
}

function applyChainedMinWithSightseeingCap(
  arrival: number,
  chainedMin: number,
  latestStart: number
): number {
  if (chainedMin > latestStart) {
    return Math.min(arrival, latestStart);
  }
  return Math.min(Math.max(arrival, chainedMin), latestStart);
}

/** Conservative walking speed for scheduling (km/h). */
export const SCHEDULE_WALK_SPEED_KMH = 4;

/** Extra buffer per leg for exiting, waiting, finding entrance. */
export const SCHEDULE_TRAVEL_BUFFER_MINUTES = 10;

export function estimateScheduleTravelMinutes(from: LatLng, to: LatLng): number {
  const km = haversineDistance(from, to);
  if (km >= EXCURSION_DISTANCE_KM) {
    // Day-trip legs assume car / train (~60 km/h), not walking.
    const transitMinutes = Math.max(45, Math.round((km / 60) * 60));
    return transitMinutes + SCHEDULE_TRAVEL_BUFFER_MINUTES;
  }
  const walkMinutes = Math.max(1, Math.round((km / SCHEDULE_WALK_SPEED_KMH) * 60));
  return walkMinutes + SCHEDULE_TRAVEL_BUFFER_MINUTES;
}

export interface ScheduleTimeStop {
  stop_type: string;
  meal_type?: string | null;
  duration_minutes: number | null;
  scheduled_time: string | null;
  place?: { lat: number; lng: number; category?: PlaceCategory; name?: string } | null;
  anchor_time?: string | null;
  opening_hours?: OpeningHours | null;
}

function stopLocation(stop: ScheduleTimeStop, fallback: LatLng): LatLng {
  if (stop.place) return { lat: stop.place.lat, lng: stop.place.lng };
  return fallback;
}

function stopDuration(stop: ScheduleTimeStop): number {
  return stop.duration_minutes ?? 60;
}

/**
 * Recompute arrival times in sort order: previous departure + travel → arrival,
 * then add stay duration before the next leg.
 */
export function recomputeScheduleTimes(
  stops: ScheduleTimeStop[],
  startLocation: LatLng,
  dayStartMinutes: number,
  dateStr?: string
): { scheduled_time: string }[] {
  const indexed = stops.map((stop, index) => ({ stop, index }));
  indexed.sort((a, b) => compareStopsByDayRhythm(a.stop, b.stop));

  const ordered = indexed.map((x) => x.stop);
  const results: string[] = new Array(stops.length);

  let readyToLeave = dayStartMinutes;
  let location = startLocation;

  for (let i = 0; i < indexed.length; i++) {
    const { stop, index } = indexed[i];
    if (stop.stop_type === "rest") {
      const arrival = stop.scheduled_time
        ? parseTimeToMinutes(stop.scheduled_time)
        : readyToLeave;
      results[index] = minutesToTimeString(arrival);
      readyToLeave = arrival + stopDuration(stop);
      location = startLocation;
      continue;
    }

    const dest = stopLocation(stop, location);
    let arrival: number;

    if (stop.anchor_time) {
      arrival = parseTimeToMinutes(stop.anchor_time);
    } else {
      const travel = estimateScheduleTravelMinutes(location, dest);
      const chainedMin = readyToLeave + travel;
      arrival = chainedMin;

      if (stop.scheduled_time) {
        const placedEarly = parseTimeToMinutes(stop.scheduled_time);
        if (placedEarly < dayStartMinutes) {
          arrival = placedEarly;
        }
      }

      const nextAnchor = nextAnchoredStopAfter(ordered, i);
      let mealLatestStart: number | undefined;
      if (nextAnchor != null) {
        const travelToAnchor = estimateScheduleTravelMinutes(dest, nextAnchor.place);
        mealLatestStart = nextAnchor.minutes - travelToAnchor - stopDuration(stop);
      }

      if (stop.meal_type && stop.meal_type in MEAL_WINDOWS) {
        const placed = stop.scheduled_time
          ? parseTimeToMinutes(stop.scheduled_time)
          : null;
        if (dateStr) {
          const meal = stop.meal_type as MealType;
          const duration = stopDuration(stop);
          const mealEarliest = getMealEarliestMinutes(
            meal,
            dateStr,
            stop.opening_hours
          );
          const isLateBrunch =
            meal === "breakfast" &&
            placed != null &&
            placed > MEAL_WINDOWS.breakfast.end;
          let afterAnchorMinutes = minutesAfterPriorMorningAnchors(
            ordered,
            i,
            dest,
            estimateScheduleTravelMinutes
          );
          if (
            afterAnchorMinutes == null &&
            nextAnchor != null &&
            mealLatestStart != null &&
            mealEarliest > mealLatestStart
          ) {
            for (let j = i + 1; j < ordered.length; j++) {
              const anchorStop = ordered[j];
              if (!anchorStop.anchor_time || !anchorStop.place) continue;
              const anchorEnd =
                parseTimeToMinutes(anchorStop.anchor_time) +
                stopDuration(anchorStop);
              afterAnchorMinutes =
                anchorEnd +
                estimateScheduleTravelMinutes(
                  { lat: anchorStop.place.lat, lng: anchorStop.place.lng },
                  dest
                );
              break;
            }
          }

          let mealTravelFloor = chainedMin;
          if (afterAnchorMinutes != null) {
            mealTravelFloor = Math.max(mealTravelFloor, afterAnchorMinutes);
          }
          if (isLateBrunch && placed != null) {
            mealTravelFloor = Math.max(mealTravelFloor, placed);
          }
          mealTravelFloor = Math.max(mealTravelFloor, MEAL_WINDOWS[meal].start, mealEarliest);

          if (afterAnchorMinutes != null || isLateBrunch) {
            const notBefore = Math.max(
              mealTravelFloor,
              afterAnchorMinutes ?? 0,
              isLateBrunch && placed != null ? placed : 0
            );
            arrival = resolveMealArrivalMinutes(
              dateStr,
              mealTravelFloor,
              null,
              meal,
              duration,
              stop.opening_hours,
              { notBefore }
            );
          } else {
            arrival = resolveMealArrivalMinutes(
              dateStr,
              mealTravelFloor,
              placed != null && placed >= dayStartMinutes ? placed : null,
              meal,
              duration,
              stop.opening_hours,
              mealLatestStart != null ? { latestStart: mealLatestStart } : undefined
            );
          }
          arrival = Math.max(arrival, chainedMin);
        } else if (placed == null || placed >= MEAL_WINDOWS[stop.meal_type as MealType].start) {
          arrival = Math.max(arrival, MEAL_WINDOWS[stop.meal_type as MealType].start);
          if (placed != null) arrival = Math.max(arrival, placed);
          arrival = Math.max(arrival, chainedMin);
        }
      } else if (dateStr && stop.place?.category) {
        const duration =
          stop.duration_minutes ?? getDefaultVisitMinutes(stop.place.category);
        const category = stop.place.category;
        const outdoor = stop.place.name
          ? isParkOrNaturePlace([], stop.place.name)
          : false;
        const experience = stop.place.name
          ? isExperienceActivity([], stop.place.name)
          : false;
        const visitOptions = { outdoor, experience };
        const resolved = resolveVisitArrivalMinutes(
          dateStr,
          chainedMin,
          category,
          duration,
          stop.opening_hours,
          visitOptions
        );
        if (resolved != null) {
          arrival = resolved;
        } else if (outdoor || experience) {
          const cap =
            (outdoor ? 18 * 60 : 18 * 60 + 30) - duration;
          arrival = Math.min(chainedMin, cap);
          const adjusted = adjustStartForOpeningHours(
            dateStr,
            arrival,
            duration,
            category,
            stop.opening_hours,
            cap
          );
          if (adjusted != null) arrival = adjusted;
        } else {
          const latestStart = sightseeingLatestStartMinutes(
            dateStr,
            category,
            duration,
            stop.opening_hours,
            visitOptions
          );
          arrival = Math.max(chainedMin, getCategoryEarliestOpen(category));
          arrival = Math.min(arrival, latestStart);
          const adjusted = adjustStartForOpeningHours(
            dateStr,
            arrival,
            duration,
            category,
            stop.opening_hours,
            latestStart
          );
          if (adjusted != null) arrival = adjusted;
        }

        if (isLateNightCategory(category)) {
          arrival = Math.max(arrival, chainedMin);
        } else {
          const latestStart = sightseeingLatestStartMinutes(
            dateStr,
            category,
            duration,
            stop.opening_hours,
            visitOptions
          );
          arrival = applyChainedMinWithSightseeingCap(arrival, chainedMin, latestStart);
        }
      } else {
        arrival = Math.max(arrival, chainedMin);
      }
    }

    if (isMealClassifiedStop(stop)) {
      let latestMealEnd: number | null = null;
      for (let j = 0; j < i; j++) {
        const prior = ordered[j];
        if (!isMealClassifiedStop(prior)) continue;
        const priorIndex = indexed[j].index;
        const priorTime = results[priorIndex];
        if (!priorTime) continue;
        const priorStart = parseTimeToMinutes(priorTime);
        const priorDuration = stopDuration(prior);
        latestMealEnd = Math.max(latestMealEnd ?? 0, priorStart + priorDuration);
      }
      if (latestMealEnd != null) {
        const minStart = latestMealEnd + MEAL_ACTIVITY_GAP;
        const travel = estimateScheduleTravelMinutes(location, dest);
        const chainedMinForGuard = readyToLeave + travel;
        if (arrival < minStart) {
          if (!stop.anchor_time) {
            arrival = Math.max(arrival, minStart, chainedMinForGuard);
          } else {
            console.warn(
              `[schedule] meal overlap: anchor at ${minutesToTimeString(arrival)} conflicts with prior meal-classified stop ending ${minutesToTimeString(latestMealEnd)}`
            );
          }
        }
      }
    }

    results[index] = minutesToTimeString(arrival);
    readyToLeave = arrival + stopDuration(stop);
    location = dest;
  }

  return results.map((scheduled_time) => ({
    scheduled_time: scheduled_time ?? minutesToTimeString(dayStartMinutes),
  }));
}
