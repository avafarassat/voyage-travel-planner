import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolTag, Trip, TripInterest } from "@/lib/types";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  mapGoogleResultToPoolCandidate,
  mergeMappedCandidates,
  mergePoolTags,
  mealTypeFromSuggestionKey,
  interestTagsForResult,
  type GooglePoolSearchResult,
  type MappedPoolCandidate,
  type PoolDiscoverySource,
} from "@/lib/itinerary/pool-tags";

export type GenerateFetchPools = {
  interestPool: GooglePoolSearchResult[];
  restaurantPool: GooglePoolSearchResult[];
  parksPool: GooglePoolSearchResult[];
  experiencesPool: GooglePoolSearchResult[];
  mealSuggestions: Map<string, GooglePoolSearchResult>;
};

/** Normalized destination key, e.g. `barcelona|spain`. */
export function normalizeDestinationSlug(city: string, country?: string | null): string {
  const norm = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const cityPart = norm(city);
  if (!cityPart) return "unknown";

  const countryPart = country?.trim() ? norm(country) : "";
  return countryPart ? `${cityPart}|${countryPart}` : cityPart;
}

type SourceCounts = Record<PoolDiscoverySource, number>;

function emptySourceCounts(): SourceCounts {
  return {
    interest_search: 0,
    meal_search: 0,
    restaurant_pool: 0,
    parks_pool: 0,
    experiences_pool: 0,
  };
}

function addToBatch(
  batch: Map<string, MappedPoolCandidate>,
  candidate: MappedPoolCandidate,
  sourceCounts: SourceCounts,
  source: PoolDiscoverySource
): void {
  sourceCounts[source]++;
  const existing = batch.get(candidate.google_place_id);
  if (!existing) {
    batch.set(candidate.google_place_id, candidate);
    return;
  }
  batch.set(candidate.google_place_id, mergeMappedCandidates(existing, candidate));
}

function buildCandidateBatch(
  pools: GenerateFetchPools,
  interests: TripInterest[]
): { batch: Map<string, MappedPoolCandidate>; sourceCounts: SourceCounts } {
  const batch = new Map<string, MappedPoolCandidate>();
  const sourceCounts = emptySourceCounts();

  for (const result of pools.interestPool) {
    addToBatch(
      batch,
      mapGoogleResultToPoolCandidate(result, {
        discovery_source: "interest_search",
        interestTags: interestTagsForResult(result, interests),
      }),
      sourceCounts,
      "interest_search"
    );
  }

  for (const result of pools.restaurantPool) {
    addToBatch(
      batch,
      mapGoogleResultToPoolCandidate(result, {
        discovery_source: "restaurant_pool",
      }),
      sourceCounts,
      "restaurant_pool"
    );
  }

  for (const result of pools.parksPool) {
    addToBatch(
      batch,
      mapGoogleResultToPoolCandidate(result, {
        discovery_source: "parks_pool",
      }),
      sourceCounts,
      "parks_pool"
    );
  }

  for (const result of pools.experiencesPool) {
    addToBatch(
      batch,
      mapGoogleResultToPoolCandidate(result, {
        discovery_source: "experiences_pool",
      }),
      sourceCounts,
      "experiences_pool"
    );
  }

  for (const [key, result] of pools.mealSuggestions) {
    const mealType = mealTypeFromSuggestionKey(key);
    addToBatch(
      batch,
      mapGoogleResultToPoolCandidate(result, {
        discovery_source: "meal_search",
        mealType: mealType ?? undefined,
      }),
      sourceCounts,
      "meal_search"
    );
  }

  return { batch, sourceCounts };
}

export async function upsertDestinationForTrip(
  supabase: SupabaseClient,
  trip: Pick<Trip, "city" | "country" | "destination_lat" | "destination_lng">,
  fallbackCoords?: { lat: number; lng: number }
): Promise<string | null> {
  const slug = normalizeDestinationSlug(trip.city, trip.country);
  let center_lat = trip.destination_lat;
  let center_lng = trip.destination_lng;

  if (
    (center_lat == null || center_lng == null) &&
    fallbackCoords &&
    Number.isFinite(fallbackCoords.lat) &&
    Number.isFinite(fallbackCoords.lng)
  ) {
    center_lat = fallbackCoords.lat;
    center_lng = fallbackCoords.lng;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("destinations")
    .upsert(
      {
        slug,
        city: trip.city.trim(),
        country: trip.country?.trim() || null,
        center_lat,
        center_lng,
        updated_at: now,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();

  if (error) {
    console.warn("[candidate-pool] upsert_failed", {
      phase: "destination",
      slug,
      message: error.message,
    });
    return null;
  }

  console.info("[candidate-pool] destination_upserted", {
    slug,
    destinationId: data.id,
  });
  return data.id;
}

export async function upsertDestinationCandidates(
  supabase: SupabaseClient,
  destinationId: string,
  candidates: MappedPoolCandidate[]
): Promise<{ upserted: number; mergedWithExisting: number }> {
  if (candidates.length === 0) {
    return { upserted: 0, mergedWithExisting: 0 };
  }

  const googleIds = candidates.map((c) => c.google_place_id);
  const { data: existingRows, error: fetchError } = await supabase
    .from("destination_place_candidates")
    .select("google_place_id, pool_tags")
    .eq("destination_id", destinationId)
    .in("google_place_id", googleIds);

  if (fetchError) {
    console.warn("[candidate-pool] upsert_failed", {
      phase: "candidates_fetch_existing",
      destinationId,
      message: fetchError.message,
    });
    return { upserted: 0, mergedWithExisting: 0 };
  }

  const existingTagsByGoogleId = new Map<string, PoolTag[]>(
    (existingRows ?? []).map((row) => [
      row.google_place_id as string,
      (row.pool_tags ?? []) as PoolTag[],
    ])
  );

  let mergedWithExisting = 0;
  const now = new Date().toISOString();
  const rows = candidates.map((candidate) => {
    const existingTags = existingTagsByGoogleId.get(candidate.google_place_id);
    let pool_tags = candidate.pool_tags;
    if (existingTags?.length) {
      mergedWithExisting++;
      pool_tags = mergePoolTags(existingTags, candidate.pool_tags);
    }

    return {
      destination_id: destinationId,
      google_place_id: candidate.google_place_id,
      name: candidate.name,
      address: candidate.address,
      lat: candidate.lat,
      lng: candidate.lng,
      primary_category: candidate.primary_category,
      pool_tags,
      google_types: candidate.google_types,
      rating: candidate.rating,
      user_ratings_total: candidate.user_ratings_total,
      price_level: candidate.price_level,
      opening_hours: candidate.opening_hours,
      is_sit_down_restaurant: candidate.is_sit_down_restaurant,
      is_experience: candidate.is_experience,
      is_park_nature: candidate.is_park_nature,
      quality_score: candidate.quality_score,
      global_status: "active" as const,
      permanently_closed: false,
      discovery_source: candidate.discovery_source,
      last_seen_at: now,
      last_refreshed_at: now,
    };
  });

  const { error: upsertError } = await supabase
    .from("destination_place_candidates")
    .upsert(rows, { onConflict: "destination_id,google_place_id" });

  if (upsertError) {
    console.warn("[candidate-pool] upsert_failed", {
      phase: "candidates",
      destinationId,
      count: rows.length,
      message: upsertError.message,
    });
    return { upserted: 0, mergedWithExisting: 0 };
  }

  return { upserted: rows.length, mergedWithExisting };
}

/**
 * Passive write-through after Generate Google fetches.
 * Non-blocking: failures are logged and do not affect itinerary generation.
 */
export async function writeThroughGenerateCandidatePools(
  trip: Pick<Trip, "city" | "country" | "destination_lat" | "destination_lng">,
  hotel: { lat: number; lng: number },
  interests: TripInterest[],
  pools: GenerateFetchPools
): Promise<void> {
  const service = createServiceRoleClient();
  if (!service) {
    console.warn("[candidate-pool] upsert_failed", {
      phase: "service_client",
      message: "SUPABASE_SERVICE_ROLE_KEY not configured — skipping pool write-through",
    });
    return;
  }

  const { batch, sourceCounts } = buildCandidateBatch(pools, interests);
  if (batch.size === 0) return;

  try {
    const destinationId = await upsertDestinationForTrip(service, trip, hotel);
    if (!destinationId) return;

    const candidates = [...batch.values()];
    const { upserted, mergedWithExisting } = await upsertDestinationCandidates(
      service,
      destinationId,
      candidates
    );

    if (upserted === 0) return;

    const tagCounts: Partial<Record<string, number>> = {};
    for (const candidate of candidates) {
      for (const tag of candidate.pool_tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    }

    console.info("[candidate-pool] candidates_upserted", {
      destinationId,
      uniqueCandidates: batch.size,
      upserted,
      mergedWithExisting,
      bySource: sourceCounts,
      tagCounts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[candidate-pool] upsert_failed", {
      phase: "write_through",
      message,
    });
  }
}
