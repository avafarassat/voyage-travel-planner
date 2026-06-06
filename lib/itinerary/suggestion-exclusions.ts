import type { ItineraryStop, Place } from "@/lib/types";

type StopWithPlace = {
  is_completed?: boolean;
  place?: Pick<Place, "google_place_id"> | null;
};

/**
 * Google place IDs to skip when fetching or suggesting new venues.
 * Excludes manual My Places and stops already on the itinerary — not every
 * stale suggested row accumulated in the places table.
 */
export function getSuggestionExcludeGoogleIds(
  places: Pick<Place, "google_place_id" | "source">[],
  stops: StopWithPlace[] = [],
  extra: string[] = []
): string[] {
  const excluded = new Set(extra.filter(Boolean));

  for (const place of places) {
    if (place.source === "manual" && place.google_place_id) {
      excluded.add(place.google_place_id);
    }
  }

  for (const stop of stops) {
    const place = stop.place;
    const googleId =
      place && !Array.isArray(place) ? place.google_place_id : undefined;
    if (!googleId) continue;
    if (stop.is_completed) {
      excluded.add(googleId);
      continue;
    }
    excluded.add(googleId);
  }

  return [...excluded];
}
