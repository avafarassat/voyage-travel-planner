import type { LatLng, PlaceCategory } from "@/lib/types";
import { isExperienceActivity, isParkOrNaturePlace } from "@/lib/types";
import {
  minutesAfterPriorMorningAnchors,
  nextAnchoredStopAfter,
  sortStopsByDayRhythm,
} from "@/lib/itinerary/day-rhythm";
import {
  adjustStartForOpeningHours,
  getCategoryEarliestOpen,
  getCategoryLatestOpen,
  getDefaultVisitMinutes,
  getMealEarliestMinutes,
  MEAL_WINDOWS,
  resolveMealArrivalMinutes,
  resolveVisitArrivalMinutes,
  type MealType,
  type OpeningHours,
} from "@/lib/itinerary/hours";
import { estimateScheduleTravelMinutes } from "@/lib/itinerary/schedule-times";

/** Minimum gap after a meal ends before the next meal-classified stop (mirrors meal-slots). */
const MEAL_ACTIVITY_GAP = 30;

function isMealClassifiedStop(stop: RescheduleStop): boolean {
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

/** Honor travel chain unless chainedMin is past the sightseeing latest-start cap. */
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

export interface RescheduleStop {
  id: string;
  sort_order: number;
  stop_type: string;
  meal_type?: string | null;
  duration_minutes: number | null;
  scheduled_time: string | null;
  anchor_time?: string | null;
  place?: { lat: number; lng: number; category?: PlaceCategory; name?: string } | null;
  opening_hours?: OpeningHours | null;
}

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Parse day bounds; end times before start (e.g. 02:00 after a 08:00 start) roll to next day. */
export function parseDayBounds(
  dayStartTime: string | null | undefined,
  dayEndTime: string | null | undefined,
  defaults: { start?: string; end?: string } = {}
): { dayStartMinutes: number; dayEndMinutes: number } {
  const dayStartMinutes = parseTimeToMinutes(
    (dayStartTime ?? defaults.start ?? "08:00:00").slice(0, 8)
  );
  let dayEndMinutes = parseTimeToMinutes(
    (dayEndTime ?? defaults.end ?? "22:00:00").slice(0, 8)
  );
  if (dayEndMinutes <= dayStartMinutes) {
    dayEndMinutes += 24 * 60;
  }
  return { dayStartMinutes, dayEndMinutes };
}

export function minutesToTimeString(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/** Recompute scheduled_time for all stops in order from a start point. */
export function rescheduleStopsFromOrder(
  stops: RescheduleStop[],
  startLocation: LatLng,
  dayStartMinutes: number,
  dayDate: string,
  travelMinutesFn: (from: LatLng, to: LatLng) => number = estimateScheduleTravelMinutes
): { id: string; scheduled_time: string }[] {
  const rhythmSorted = sortStopsByDayRhythm(stops);
  const idOrder = rhythmSorted.map((s) => s.id);

  let readyToLeave = dayStartMinutes;
  let location = startLocation;
  const timeById = new Map<string, string>();

  for (let i = 0; i < rhythmSorted.length; i++) {
    const stop = rhythmSorted[i];
    if (stop.stop_type === "rest") {
      const arrival = stop.scheduled_time
        ? parseTimeToMinutes(stop.scheduled_time)
        : readyToLeave;
      timeById.set(stop.id, minutesToTimeString(arrival));
      readyToLeave = arrival + (stop.duration_minutes ?? 60);
      location = startLocation;
      continue;
    }

    if (stop.place) {
      const travel = travelMinutesFn(location, {
        lat: stop.place.lat,
        lng: stop.place.lng,
      });
      const chainedMin = readyToLeave + travel;
      let arrival = chainedMin;

      if (stop.anchor_time) {
        arrival = parseTimeToMinutes(stop.anchor_time);
      } else if (stop.meal_type && stop.meal_type in MEAL_WINDOWS) {
        const placed = stop.scheduled_time
          ? parseTimeToMinutes(stop.scheduled_time)
          : null;
        const duration =
          stop.duration_minutes ??
          getDefaultVisitMinutes(stop.place?.category ?? "restaurant");
        const meal = stop.meal_type as MealType;

        const nextAnchor = nextAnchoredStopAfter(rhythmSorted, i);
        let mealLatestStart: number | undefined;
        if (nextAnchor != null) {
          const travelToAnchor = travelMinutesFn(
            { lat: stop.place.lat, lng: stop.place.lng },
            nextAnchor.place
          );
          mealLatestStart = nextAnchor.minutes - travelToAnchor - duration;
        }
        const mealEarliest = getMealEarliestMinutes(
          meal,
          dayDate,
          stop.opening_hours
        );
        const isLateBrunch =
          meal === "breakfast" &&
          placed != null &&
          placed > MEAL_WINDOWS.breakfast.end;
        let afterAnchorMinutes = minutesAfterPriorMorningAnchors(
          rhythmSorted,
          i,
          { lat: stop.place.lat, lng: stop.place.lng },
          travelMinutesFn
        );
        if (
          afterAnchorMinutes == null &&
          nextAnchor != null &&
          mealLatestStart != null &&
          mealEarliest > mealLatestStart
        ) {
          for (let j = i + 1; j < rhythmSorted.length; j++) {
            const anchorStop = rhythmSorted[j];
            if (!anchorStop.anchor_time || !anchorStop.place) continue;
            const anchorEnd =
              parseTimeToMinutes(anchorStop.anchor_time) +
              (anchorStop.duration_minutes ??
                getDefaultVisitMinutes(anchorStop.place.category ?? "monument"));
            afterAnchorMinutes =
              anchorEnd +
              travelMinutesFn(
                { lat: anchorStop.place.lat, lng: anchorStop.place.lng },
                { lat: stop.place.lat, lng: stop.place.lng }
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
            dayDate,
            mealTravelFloor,
            null,
            meal,
            duration,
            stop.opening_hours,
            { notBefore }
          );
        } else {
          arrival = resolveMealArrivalMinutes(
            dayDate,
            mealTravelFloor,
            placed,
            meal,
            duration,
            stop.opening_hours,
            mealLatestStart != null ? { latestStart: mealLatestStart } : undefined
          );
        }
        arrival = Math.max(arrival, chainedMin);
      } else {
        const duration =
          stop.duration_minutes ??
          getDefaultVisitMinutes(stop.place.category ?? "activity");
        const category = stop.place.category ?? "activity";
        const outdoor = stop.place.name
          ? isParkOrNaturePlace([], stop.place.name)
          : false;
        const experience = stop.place.name
          ? isExperienceActivity([], stop.place.name)
          : false;
        const visitOptions = { outdoor, experience };
        const resolved = resolveVisitArrivalMinutes(
          dayDate,
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
            (outdoor ? 18 * 60 : 18 * 60 + 30) -
            duration;
          arrival = Math.min(chainedMin, cap);
          const adjusted = adjustStartForOpeningHours(
            dayDate,
            arrival,
            duration,
            category,
            stop.opening_hours,
            cap
          );
          if (adjusted != null) arrival = adjusted;
        } else {
          const latestStart = sightseeingLatestStartMinutes(
            dayDate,
            category,
            duration,
            stop.opening_hours,
            visitOptions
          );
          arrival = Math.max(chainedMin, getCategoryEarliestOpen(category));
          arrival = Math.min(arrival, latestStart);
          const adjusted = adjustStartForOpeningHours(
            dayDate,
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
            dayDate,
            category,
            duration,
            stop.opening_hours,
            visitOptions
          );
          arrival = applyChainedMinWithSightseeingCap(arrival, chainedMin, latestStart);
        }
      }

      if (isMealClassifiedStop(stop)) {
        let latestMealEnd: number | null = null;
        for (let j = 0; j < i; j++) {
          const prior = rhythmSorted[j];
          if (!isMealClassifiedStop(prior)) continue;
          const priorTime = timeById.get(prior.id);
          if (!priorTime) continue;
          const priorStart = parseTimeToMinutes(priorTime);
          const priorDuration =
            prior.duration_minutes ??
            getDefaultVisitMinutes(prior.place?.category ?? "restaurant");
          latestMealEnd = Math.max(
            latestMealEnd ?? 0,
            priorStart + priorDuration
          );
        }
        if (latestMealEnd != null) {
          const minStart = latestMealEnd + MEAL_ACTIVITY_GAP;
          if (arrival < minStart) {
            if (!stop.anchor_time) {
              arrival = Math.max(arrival, minStart, chainedMin);
            } else {
              console.warn(
                `[reschedule] meal overlap: anchor ${stop.id} at ${minutesToTimeString(arrival)} conflicts with prior meal-classified stop ending ${minutesToTimeString(latestMealEnd)}`
              );
            }
          }
        }
      }

      timeById.set(stop.id, minutesToTimeString(arrival));
      const duration =
        stop.duration_minutes ??
        getDefaultVisitMinutes(stop.place.category ?? "activity");
      readyToLeave = arrival + duration;
      location = { lat: stop.place.lat, lng: stop.place.lng };
    } else {
      timeById.set(stop.id, minutesToTimeString(readyToLeave));
      readyToLeave += stop.duration_minutes ?? 60;
    }
  }

  return idOrder.map((id) => ({
    id,
    scheduled_time: timeById.get(id) ?? minutesToTimeString(dayStartMinutes),
  }));
}

/** Reorder sort_order to match day rhythm (breakfast → … → nightlife). */
export function rhythmSortOrderUpdates(
  stops: RescheduleStop[]
): { id: string; sort_order: number }[] {
  const sorted = sortStopsByDayRhythm(stops);
  return sorted.map((stop, sort_order) => ({ id: stop.id, sort_order }));
}

/** Recompute times for stops after a given index (pinned stops keep their set times). */
export function rescheduleFollowingStops(
  stops: RescheduleStop[],
  fromIndex: number,
  startLocation: LatLng,
  departureMinutes: number,
  departureLocation: LatLng
): { id: string; scheduled_time: string }[] {
  const sorted = [...stops].sort((a, b) => a.sort_order - b.sort_order);
  const tail = sorted.slice(fromIndex + 1);
  if (tail.length === 0) return [];

  let readyToLeave = departureMinutes;
  let location = departureLocation;
  const updates: { id: string; scheduled_time: string }[] = [];

  for (const stop of tail) {
    if (stop.stop_type === "rest") {
      const arrival = stop.scheduled_time
        ? parseTimeToMinutes(stop.scheduled_time)
        : readyToLeave;
      updates.push({
        id: stop.id,
        scheduled_time: minutesToTimeString(arrival),
      });
      readyToLeave = arrival + (stop.duration_minutes ?? 60);
      location = startLocation;
      continue;
    }

    if (stop.place) {
      const travel = estimateScheduleTravelMinutes(location, {
        lat: stop.place.lat,
        lng: stop.place.lng,
      });
      let arrival = readyToLeave + travel;

      if (stop.anchor_time) {
        // User-set reservation — never shift this time.
        arrival = parseTimeToMinutes(stop.anchor_time);
      }

      updates.push({
        id: stop.id,
        scheduled_time: minutesToTimeString(arrival),
      });
      const duration =
        stop.duration_minutes ??
        getDefaultVisitMinutes(stop.place.category ?? "activity");
      readyToLeave = arrival + duration;
      location = { lat: stop.place.lat, lng: stop.place.lng };
    } else {
      updates.push({
        id: stop.id,
        scheduled_time: minutesToTimeString(readyToLeave),
      });
      readyToLeave += stop.duration_minutes ?? 60;
    }
  }

  return updates;
}

/** Haversine-based travel estimate when API unavailable. */
export function estimateTravelMinutes(from: LatLng, to: LatLng): number {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return Math.max(1, Math.round((km / 5) * 60));
}
