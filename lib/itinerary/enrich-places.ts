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
  liveDetailsAttempted: number;
  skippedQuota: number;
  missingCoordinates: number;
}

export function emptyStoredPlaceHydrationStats(): StoredPlaceHydrationStats {
  return {
    fromStoredDb: 0,
    fromDestinationPool: 0,
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

async function persistOpeningHours(
  supabase: SupabaseClient,
  placeId: string,
  openingHours: NonNullable<Place["opening_hours"]>
): Promise<void> {
  await supabase.from("places").update({ opening_hours: openingHours }).eq("id", placeId);
}

/**
 * Stored-data-first opening-hours hydration: DB → destination pool → live details (quota-gated).
 * Mutates `places` in memory when hours are resolved.
 */
export async function hydratePlacesOpeningHoursStoredFirst(
  supabase: SupabaseClient,
  places: Place[],
  apiKey: string,
  quotaGate: PlacesQuotaGate | undefined,
  trip: Pick<Trip, "city" | "country"> | undefined,
  stats?: StoredPlaceHydrationStats
): Promise<StoredPlaceHydrationStats> {
  const counts = stats ?? emptyStoredPlaceHydrationStats();

  const needsHours = places.filter(
    (p) => p.google_place_id && !hasUsableOpeningHours(p.opening_hours)
  );
  const poolByGoogleId = trip
    ? await loadDestinationPoolRowsByGoogleIds(
        trip,
        needsHours.map((p) => p.google_place_id!)
      )
    : new Map<string, DestinationPoolRow>();

  for (const place of places) {
    if (!placeHasCoordinates(place)) {
      counts.missingCoordinates++;
    }

    if (hasUsableOpeningHours(place.opening_hours)) {
      counts.fromStoredDb++;
      continue;
    }

    if (!place.google_place_id) continue;

    const poolRow = poolByGoogleId.get(place.google_place_id);
    if (poolRow && poolRowHasUsableHours(poolRow)) {
      place.opening_hours = poolRow.opening_hours;
      counts.fromDestinationPool++;
      await persistOpeningHours(supabase, place.id, poolRow.opening_hours!);
      continue;
    }

    if (quotaGate && !quotaGate.allowLiveFetch()) {
      counts.skippedQuota++;
      continue;
    }

    counts.liveDetailsAttempted++;
    const details = await fetchPlaceDetails(place.google_place_id, apiKey, quotaGate);
    if (!details?.openingHours) continue;

    place.opening_hours = details.openingHours;
    await persistOpeningHours(supabase, place.id, details.openingHours);
  }

  return counts;
}

/** Pre-generate hydration: stored DB + destination pool only; live details quota-gated. No photos. */
export async function hydratePlacesForGenerate(
  supabase: SupabaseClient,
  trip: Pick<Trip, "city" | "country">,
  places: Place[],
  apiKey: string,
  quotaGate: PlacesQuotaGate
): Promise<StoredPlaceHydrationStats> {
  return hydratePlacesOpeningHoursStoredFirst(
    supabase,
    places,
    apiKey,
    quotaGate,
    trip
  );
}

/** Fetch and persist Google opening hours for places missing them (awaited before reschedule). */
export async function enrichPlacesOpeningHours(
  supabase: SupabaseClient,
  places: Place[],
  apiKey: string,
  quotaGate?: PlacesQuotaGate,
  trip?: Pick<Trip, "city" | "country">
): Promise<void> {
  await hydratePlacesOpeningHoursStoredFirst(supabase, places, apiKey, quotaGate, trip);
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
