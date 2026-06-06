import { placeTheme } from "@/lib/itinerary/place-theme";
import type { Place } from "@/lib/types";
import { placeHasReservation } from "@/lib/utils";

/** User-saved places that must appear on the itinerary (not auto-suggested). */
export function getManualPlaces(places: Place[]): Place[] {
  return places.filter((p) => p.source === "manual");
}

export function manualPlaceGoogleId(place: Place): string | null {
  return place.google_place_id ?? null;
}

/**
 * Manual places scheduled via reservation anchors (restaurants/bars at booked times).
 * All other manual places get a dedicated sightseeing slot.
 */
export function manualPlaceUsesReservationAnchor(place: Place): boolean {
  return placeHasReservation(place) && place.category === "restaurant";
}

/** Assign every manual place without a reservation to exactly one trip day. */
export function assignManualPlacesToDays(
  manualPlaces: Place[],
  dates: string[]
): Map<string, Place[]> {
  const byDay = new Map<string, Place[]>();
  const dayThemes = new Map<string, Set<string>>();
  for (const date of dates) {
    byDay.set(date, []);
    dayThemes.set(date, new Set());
  }

  const unreserved = manualPlaces.filter(
    (p) => !placeHasReservation(p) && !manualPlaceUsesReservationAnchor(p)
  );

  const themed = unreserved.map((place) => ({
    place,
    theme: placeTheme(place.name, place.category),
    priority: manualPlacePriority(place),
  }));

  themed.sort((a, b) => a.priority - b.priority);

  let remaining = [...themed];
  let guard = 0;
  while (remaining.length > 0 && guard++ < unreserved.length * dates.length * 3) {
    let placedThisRound = false;
    for (const date of dates) {
      if (remaining.length === 0) break;
      const themes = dayThemes.get(date)!;
      const idx = remaining.findIndex((item) => !themes.has(item.theme));
      const pickIdx = idx === -1 ? 0 : idx;
      const item = remaining.splice(pickIdx, 1)[0];
      byDay.get(date)!.push(item.place);
      themes.add(item.theme);
      placedThisRound = true;
    }
    if (!placedThisRound) break;
  }

  for (const item of remaining) {
    const date = dates.reduce((best, d) =>
      byDay.get(d)!.length < byDay.get(best)!.length ? d : best
    );
    byDay.get(date)!.push(item.place);
    dayThemes.get(date)!.add(item.theme);
  }

  return byDay;
}

/** Lower = schedule earlier in the trip / higher priority when spreading days. */
function manualPlacePriority(place: Place): number {
  switch (place.category) {
    case "monument":
      return 0;
    case "museum":
      return 1;
    case "activity":
      return 2;
    case "bar":
    case "nightlife":
      return 4;
    case "restaurant":
      return 5;
    default:
      return 3;
  }
}

export function googlePlaceIdsForManualPlaces(manualPlaces: Place[]): Set<string> {
  const ids = new Set<string>();
  for (const place of manualPlaces) {
    const gid = manualPlaceGoogleId(place);
    if (gid) ids.add(gid);
  }
  return ids;
}
