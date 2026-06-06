type StopLike = {
  place_id?: string | null;
  place?: { id?: string; google_place_id?: string | null } | null;
};

export function getPlaceIdsOnDay(stops: StopLike[]): Set<string> {
  const ids = new Set<string>();
  for (const stop of stops) {
    if (stop.place_id) ids.add(stop.place_id);
    if (stop.place?.id) ids.add(stop.place.id);
  }
  return ids;
}

export function getGooglePlaceIdsOnDay(stops: StopLike[]): Set<string> {
  const ids = new Set<string>();
  for (const stop of stops) {
    const googleId = stop.place?.google_place_id;
    if (googleId) ids.add(googleId);
  }
  return ids;
}

export function isPlaceAlreadyOnDay(
  stops: StopLike[],
  placeId?: string | null,
  googlePlaceId?: string | null
): boolean {
  if (placeId && getPlaceIdsOnDay(stops).has(placeId)) return true;
  if (googlePlaceId && getGooglePlaceIdsOnDay(stops).has(googlePlaceId)) return true;
  return false;
}
