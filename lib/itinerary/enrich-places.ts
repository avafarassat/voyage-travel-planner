import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlaceDetails } from "@/lib/itinerary/google-places";
import { hasUsableOpeningHours } from "@/lib/itinerary/hours";
import type { Place, Trip } from "@/lib/types";
import type { PlacesQuotaGate } from "@/lib/itinerary/places-quota-gate";
import {
  loadDestinationPoolRowsByGoogleIds,
  type DestinationPoolRow,
} from "@/lib/itinerary/candidate-pool";

export interface StoredPlaceHydrationStats {
  fromStoredDb: number;
  fromDestinationPool: number;
  scheduleUsableWithoutHours: number;
  liveDetailsAttempted: number;
  skippedQuota: number;
  missingCoordinates: number;
}

export function emptyStoredPlaceHydrationStats(): StoredPlaceHydrationStats {
  return {
    fromStoredDb: 0,
    fromDestinationPool: 0,
    scheduleUsableWithoutHours: 0,
    liveDetailsAttempted: 0,
    skippedQuota: 0,
    missingCoordinates: 0,
  };
}

function placeHasCoordinates(place: Pick<Place, "lat" | "lng">): boolean {
  return Number.isFinite(place.lat) && Number.isFinite(place.lng);
}

function poolRowHasUsableHours(row: DestinationPoolRow): boolean {
  return hasUsableOpeningHours(row.opening_hours);
}

function poolRowHasScheduleCoordinates(row: DestinationPoolRow): boolean {
  return Number.isFinite(row.lat) && Number.isFinite(row.lng);
}

function placeHasScheduleMetadata(place: Pick<Place, "name" | "category">): boolean {
  return Boolean(place.name?.trim()) && Boolean(place.category);
}

/** True when stored (or pool) data is enough to schedule without live Place Details. */
export function isScheduleUsableStoredPlace(
  place: Place,
  poolRow?: DestinationPoolRow
): boolean {
  const hasMetadata =
    placeHasScheduleMetadata(place) ||
    Boolean(poolRow?.name?.trim() && poolRow?.primary_category);
  if (!hasMetadata) return false;

  if (placeHasCoordinates(place)) return true;
  return poolRow != null && poolRowHasScheduleCoordinates(poolRow);
}

function applyScheduleFieldsFromPool(place: Place, poolRow: DestinationPoolRow): void {
  if (!placeHasCoordinates(place) && poolRowHasScheduleCoordinates(poolRow)) {
    place.lat = poolRow.lat;
    place.lng = poolRow.lng;
  }
}

async function persistOpeningHours(
  supabase: SupabaseClient,
  placeId: string,
  openingHours: NonNullable<Place["opening_hours"]>
): Promise<void> {
  await supabase.from("places").update({ opening_hours: openingHours }).eq("id", placeId);
}

/**
 * Stored-data-first opening-hours hydration: DB → destination pool → live details (last resort).
 * Skips live Place Details when stored data is schedule-usable without opening hours.
 * Mutates `places` in memory when hours or coordinates are resolved. Sequential; quota-gated.
 */
async function hydratePlacesStoredFirst(
  supabase: SupabaseClient,
  places: Place[],
  apiKey: string,
  quotaGate: PlacesQuotaGate | undefined,
  trip: Pick<Trip, "city" | "country"> | undefined
): Promise<StoredPlaceHydrationStats> {
  const counts = emptyStoredPlaceHydrationStats();

  const googlePlaceIds = places
    .map((p) => p.google_place_id)
    .filter((id): id is string => Boolean(id));
  const poolByGoogleId =
    trip && googlePlaceIds.length > 0
      ? await loadDestinationPoolRowsByGoogleIds(trip, googlePlaceIds)
      : new Map<string, DestinationPoolRow>();

  for (const place of places) {
    const poolRow = place.google_place_id
      ? poolByGoogleId.get(place.google_place_id)
      : undefined;
    if (poolRow) {
      applyScheduleFieldsFromPool(place, poolRow);
    }

    if (hasUsableOpeningHours(place.opening_hours)) {
      counts.fromStoredDb++;
    } else if (poolRow && poolRowHasUsableHours(poolRow)) {
      place.opening_hours = poolRow.opening_hours;
      counts.fromDestinationPool++;
      await persistOpeningHours(supabase, place.id, poolRow.opening_hours!);
    } else if (isScheduleUsableStoredPlace(place, poolRow)) {
      counts.scheduleUsableWithoutHours++;
    } else if (!place.google_place_id) {
      // No google id and not schedule-usable — nothing to fetch.
    } else if (quotaGate && !quotaGate.allowLiveFetch()) {
      counts.skippedQuota++;
    } else {
      counts.liveDetailsAttempted++;
      const details = await fetchPlaceDetails(place.google_place_id, apiKey, quotaGate);
      if (details?.openingHours) {
        place.opening_hours = details.openingHours;
        await persistOpeningHours(supabase, place.id, details.openingHours);
      }
    }

    if (!placeHasCoordinates(place)) {
      counts.missingCoordinates++;
    }
  }

  return counts;
}

/** Pre-generate hydration before scheduling. No photos. */
export async function hydratePlacesForGenerate(
  supabase: SupabaseClient,
  trip: Pick<Trip, "city" | "country">,
  places: Place[],
  apiKey: string,
  quotaGate: PlacesQuotaGate
): Promise<StoredPlaceHydrationStats> {
  return hydratePlacesStoredFirst(supabase, places, apiKey, quotaGate, trip);
}

/** Post-generate opening-hours enrichment before reschedule. Pool-first; no photos. */
export async function enrichPlacesOpeningHours(
  supabase: SupabaseClient,
  places: Place[],
  apiKey: string,
  quotaGate?: PlacesQuotaGate,
  trip?: Pick<Trip, "city" | "country">
): Promise<StoredPlaceHydrationStats> {
  return hydratePlacesStoredFirst(supabase, places, apiKey, quotaGate, trip);
}

export function mergeStoredPlaceHydrationStats(
  ...parts: StoredPlaceHydrationStats[]
): StoredPlaceHydrationStats {
  const merged = emptyStoredPlaceHydrationStats();
  for (const part of parts) {
    merged.fromStoredDb += part.fromStoredDb;
    merged.fromDestinationPool += part.fromDestinationPool;
    merged.scheduleUsableWithoutHours += part.scheduleUsableWithoutHours;
    merged.liveDetailsAttempted += part.liveDetailsAttempted;
    merged.skippedQuota += part.skippedQuota;
    merged.missingCoordinates += part.missingCoordinates;
  }
  return merged;
}

/** Refresh missing photos/hours in the background — not used during Generate (scheduling does not need photos). */
export function enrichPlacesInBackground(
  supabase: SupabaseClient,
  places: Place[],
  city: string,
  apiKey: string,
  quotaGate?: PlacesQuotaGate
) {
  void import("@/lib/itinerary/google-places").then(({ resolvePlacePhoto }) =>
    Promise.all(
      places.map(async (place) => {
        const needsHours =
          place.google_place_id && !hasUsableOpeningHours(place.opening_hours);
        const needsPhoto = !place.photo_url;

        if (needsHours && place.google_place_id) {
          if (quotaGate && !quotaGate.allowLiveFetch()) return;
          const details = await fetchPlaceDetails(place.google_place_id, apiKey, quotaGate);
          if (details?.openingHours) {
            await supabase
              .from("places")
              .update({ opening_hours: details.openingHours })
              .eq("id", place.id);
          }
        }

        if (needsPhoto) {
          if (quotaGate && !quotaGate.allowLiveFetch()) return;
          const resolved = await resolvePlacePhoto(place, city, apiKey, quotaGate);
          if (!resolved?.photoUrl) return;
          const patch: { photo_url: string; google_place_id?: string } = {
            photo_url: resolved.photoUrl,
          };
          if (!place.google_place_id && resolved.googlePlaceId) {
            patch.google_place_id = resolved.googlePlaceId;
          }
          await supabase.from("places").update(patch).eq("id", place.id);
        }
      })
    )
  );
}
