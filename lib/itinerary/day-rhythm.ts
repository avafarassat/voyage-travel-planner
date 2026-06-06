import type { LatLng, PlaceCategory } from "@/lib/types";
import { getDefaultVisitMinutes, MEAL_WINDOWS } from "@/lib/itinerary/hours";

/** Day rhythm phases — breakfast → morning → lunch → afternoon → dinner → evening. */
export const DAY_PHASE = {
  BREAKFAST: 0,
  MORNING: 1,
  LUNCH: 2,
  AFTERNOON: 3,
  DINNER: 4,
  EVENING: 5,
} as const;

export type DayPhase = (typeof DAY_PHASE)[keyof typeof DAY_PHASE];

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface RhythmStop {
  stop_type?: string;
  meal_type?: string | null;
  scheduled_time?: string | null;
  anchor_time?: string | null;
  place?: {
    category?: PlaceCategory;
    reservation_time?: string | null;
  } | null;
}

/** Which slot in the required day rhythm this stop belongs to. */
export function getStopPhaseRank(stop: RhythmStop): DayPhase {
  if (stop.meal_type === "breakfast") {
    const t = stop.scheduled_time
      ? parseTimeToMinutes(stop.scheduled_time.slice(0, 8))
      : MEAL_WINDOWS.breakfast.start;
    // Brunch after a morning reservation — after sights, still before lunch.
    if (t > MEAL_WINDOWS.breakfast.end && t < MEAL_WINDOWS.lunch.start) {
      return DAY_PHASE.MORNING;
    }
    return DAY_PHASE.BREAKFAST;
  }
  if (stop.meal_type === "lunch") return DAY_PHASE.LUNCH;
  if (stop.meal_type === "dinner") return DAY_PHASE.DINNER;

  const category = stop.place?.category;
  if (category === "bar" || category === "nightlife") return DAY_PHASE.EVENING;

  const anchor = stop.anchor_time ?? stop.place?.reservation_time ?? null;
  if (anchor) {
    const mins = parseTimeToMinutes(anchor.slice(0, 8));
    if (mins >= MEAL_WINDOWS.dinner.start - 15) return DAY_PHASE.EVENING;
    if (mins >= MEAL_WINDOWS.lunch.end) return DAY_PHASE.AFTERNOON;
    return DAY_PHASE.MORNING;
  }

  const t = stop.scheduled_time
    ? parseTimeToMinutes(stop.scheduled_time.slice(0, 8))
    : MEAL_WINDOWS.lunch.start;

  if (t < MEAL_WINDOWS.lunch.start - 15) return DAY_PHASE.MORNING;
  if (t < MEAL_WINDOWS.lunch.end + 15) return DAY_PHASE.LUNCH;
  if (t < MEAL_WINDOWS.dinner.start - 15) return DAY_PHASE.AFTERNOON;
  if (t < MEAL_WINDOWS.dinner.end + 15) return DAY_PHASE.DINNER;
  return DAY_PHASE.EVENING;
}

export function stopPhaseSortKey(stop: RhythmStop): number {
  const phase = getStopPhaseRank(stop);
  const time = stop.anchor_time
    ? parseTimeToMinutes(stop.anchor_time.slice(0, 8))
    : stop.scheduled_time
      ? parseTimeToMinutes(stop.scheduled_time.slice(0, 8))
      : phase * 1000;
  return phase * 24 * 60 + time;
}

/** Sort stops into required day rhythm: breakfast → activities → lunch → activities → dinner → nightlife. */
export function sortStopsByDayRhythm<T extends RhythmStop>(stops: T[]): T[] {
  return [...stops].sort((a, b) => stopPhaseSortKey(a) - stopPhaseSortKey(b));
}

export function compareStopsByDayRhythm(a: RhythmStop, b: RhythmStop): number {
  return stopPhaseSortKey(a) - stopPhaseSortKey(b);
}

/** Earliest brunch time after morning reservation anchors that precede `index`. */
export function minutesAfterPriorMorningAnchors<
  T extends RhythmStop & {
    duration_minutes?: number | null;
    place?: { lat: number; lng: number; category?: PlaceCategory } | null;
  },
>(
  ordered: T[],
  index: number,
  dest: LatLng,
  travelMinutesFn: (from: LatLng, to: LatLng) => number
): number | undefined {
  let best: number | undefined;
  for (let j = 0; j < index; j++) {
    const anchorStop = ordered[j];
    const anchor = anchorStop.anchor_time ?? anchorStop.place?.reservation_time;
    if (!anchor || !anchorStop.place) continue;
    const anchorMins = parseTimeToMinutes(anchor.slice(0, 8));
    if (anchorMins >= MEAL_WINDOWS.lunch.start) continue;
    const duration =
      anchorStop.duration_minutes ??
      getDefaultVisitMinutes(anchorStop.place.category ?? "monument");
    const anchorEnd = anchorMins + duration;
    const candidate =
      anchorEnd +
      travelMinutesFn(
        { lat: anchorStop.place.lat, lng: anchorStop.place.lng },
        dest
      );
    best = best == null ? candidate : Math.max(best, candidate);
  }
  return best;
}

/** Next anchored reservation stop after `fromIndex`. */
export function nextAnchoredStopAfter<T extends RhythmStop & { place?: { lat: number; lng: number } | null }>(
  stops: T[],
  fromIndex: number
): { minutes: number; place: { lat: number; lng: number } } | null {
  for (let i = fromIndex + 1; i < stops.length; i++) {
    const anchor = stops[i].anchor_time ?? stops[i].place?.reservation_time;
    if (anchor && stops[i].place) {
      return {
        minutes: parseTimeToMinutes(anchor.slice(0, 8)),
        place: { lat: stops[i].place!.lat, lng: stops[i].place!.lng },
      };
    }
  }
  return null;
}
