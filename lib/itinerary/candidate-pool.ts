import type { SupabaseClient } from "@supabase/supabase-js";
import type { DestinationPlaceCandidate, PoolTag, Trip, TripInterest } from "@/lib/types";
import { isSitDownRestaurant } from "@/lib/types";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { MealType } from "@/lib/itinerary/hours";
import {
  ACTIVITY_SLOT_INTERESTS,
  candidateMatchesInterest,
  type InterestCandidate,
} from "@/lib/itinerary/interest-scheduling";
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
import type { PlacesQuotaGate } from "@/lib/itinerary/places-quota-gate";

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

/** DB row shape for pool reads (no photo fields). */
export type DestinationPoolRow = Pick<
  DestinationPlaceCandidate,
  | "google_place_id"
  | "name"
  | "address"
  | "lat"
  | "lng"
  | "primary_category"
  | "pool_tags"
  | "google_types"
  | "rating"
  | "user_ratings_total"
  | "price_level"
  | "opening_hours"
  | "is_sit_down_restaurant"
  | "is_experience"
  | "is_park_nature"
  | "quality_score"
  | "global_status"
  | "permanently_closed"
>;

export interface ResolvedDestination {
  destinationId: string;
  slug: string;
}

export interface GeneratePoolThresholds {
  breakfast: number;
  lunch: number;
  dinner: number;
  restaurant: number;
  activitySightseeing: number;
  parksNature: number | null;
  experiences: number | null;
}

export interface PoolCategoryCounts {
  totalLoaded: number;
  interestPool: number;
  restaurantPool: number;
  parksPool: number;
  experiencesPool: number;
  breakfastTagged: number;
  lunchTagged: number;
  dinnerTagged: number;
  activitySightseeing: number;
}

export interface PoolShortfall {
  category: string;
  have: number;
  need: number;
}

export interface PoolTopUpStats {
  skippedSufficient: string[];
  attemptedShort: string[];
  skippedQuota: string[];
}

const GENERATE_POOL_LIMITS = {
  interestPool: 80,
  restaurantPool: 40,
  parksPool: 35,
  experiencesPool: 35,
} as const;

/** Map a global pool row into the scheduler / Google fetch result shape (no photo URLs). */
export function mapPoolRowToSearchResult(row: DestinationPoolRow): GooglePoolSearchResult {
  const types = row.google_types ?? [];
  return {
    placeId: row.google_place_id,
    name: row.name,
    address: row.address ?? "",
    lat: row.lat,
    lng: row.lng,
    rating: row.rating ?? undefined,
    category: row.primary_category,
    types,
    openingHours: row.opening_hours ?? undefined,
    userRatingsTotal: row.user_ratings_total ?? undefined,
  };
}

function poolRowToInterestCandidate(row: DestinationPoolRow): InterestCandidate {
  return {
    name: row.name,
    category: row.primary_category,
    outdoor: row.is_park_nature,
    experience: row.is_experience,
  };
}

function rowMatchesAnyInterest(row: DestinationPoolRow, interests: TripInterest[]): boolean {
  const candidate = poolRowToInterestCandidate(row);
  return interests.some((interest) => candidateMatchesInterest(candidate, interest));
}

function rowMatchesActivitySightseeing(
  row: DestinationPoolRow,
  interests: TripInterest[]
): boolean {
  const candidate = poolRowToInterestCandidate(row);
  return ACTIVITY_SLOT_INTERESTS.some(
    (interest) => interests.includes(interest) && candidateMatchesInterest(candidate, interest)
  );
}

function hasPoolTag(row: DestinationPoolRow, tag: PoolTag): boolean {
  return (row.pool_tags ?? []).includes(tag);
}

function isActivePoolRow(row: DestinationPoolRow, excludeIds: Set<string>): boolean {
  if (row.global_status !== "active") return false;
  if (row.permanently_closed) return false;
  if (excludeIds.has(row.google_place_id)) return false;
  return true;
}

/** Find destination registry row by normalized trip city/country slug. Read-only. */
export async function resolveDestinationForTrip(
  trip: Pick<Trip, "city" | "country">,
  _hotel?: { lat: number; lng: number }
): Promise<ResolvedDestination | null> {
  const service = createServiceRoleClient();
  if (!service) return null;

  const slug = normalizeDestinationSlug(trip.city, trip.country);
  const { data, error } = await service
    .from("destinations")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("[candidate-pool] pool_read", {
      phase: "resolve_destination",
      slug,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;
  return { destinationId: data.id, slug: data.slug };
}

/** Load active global candidates for a destination, excluding manual / itinerary IDs. */
export async function loadDestinationCandidates(
  destinationId: string,
  excludeGoogleIds: string[]
): Promise<DestinationPoolRow[]> {
  const service = createServiceRoleClient();
  if (!service) return [];

  const exclude = new Set(excludeGoogleIds.filter(Boolean));
  const { data, error } = await service
    .from("destination_place_candidates")
    .select(
      "google_place_id, name, address, lat, lng, primary_category, pool_tags, google_types, rating, user_ratings_total, price_level, opening_hours, is_sit_down_restaurant, is_experience, is_park_nature, quality_score, global_status, permanently_closed"
    )
    .eq("destination_id", destinationId)
    .eq("global_status", "active")
    .eq("permanently_closed", false);

  if (error) {
    console.warn("[candidate-pool] pool_read", {
      phase: "load_candidates",
      destinationId,
      message: error.message,
    });
    return [];
  }

  return ((data ?? []) as DestinationPoolRow[]).filter((row) =>
    isActivePoolRow(row, exclude)
  );
}

export function computeGeneratePoolThresholds(
  tripDayCount: number,
  interests: TripInterest[]
): GeneratePoolThresholds {
  return {
    breakfast: tripDayCount + 2,
    lunch: tripDayCount + 2,
    dinner: tripDayCount + 2,
    restaurant: tripDayCount * 2,
    activitySightseeing: tripDayCount * 4,
    parksNature: interests.includes("parks") ? Math.ceil(tripDayCount / 2) : null,
    experiences: interests.includes("activities") ? Math.ceil(tripDayCount / 2) : null,
  };
}

function sortPoolRows(rows: DestinationPoolRow[]): DestinationPoolRow[] {
  return [...rows].sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
}

/** Assign unique restaurants across trip dates (mirrors fetchMealsForDates). */
export function assignMealSuggestionsForDates(
  dates: string[],
  mealPools: Record<MealType, GooglePoolSearchResult[]>
): Map<string, GooglePoolSearchResult> {
  const mealTypes: MealType[] = ["breakfast", "lunch", "dinner"];
  const mealSuggestions = new Map<string, GooglePoolSearchResult>();
  const growingExclude = new Set<string>();

  for (const meal of mealTypes) {
    const pool = mealPools[meal].filter((p) => !growingExclude.has(p.placeId));
    for (const place of pool) {
      growingExclude.add(place.placeId);
    }

    const usedToday = new Set<string>();
    let poolIdx = 0;
    for (const date of dates) {
      while (poolIdx < pool.length && usedToday.has(pool[poolIdx].placeId)) {
        poolIdx++;
      }
      let candidate = pool[poolIdx];
      if (!candidate && pool.length > 0) {
        candidate = pool[(dates.indexOf(date) + pool.length) % pool.length];
      }
      if (!candidate) continue;
      mealSuggestions.set(`${date}-${meal}`, candidate);
      usedToday.add(candidate.placeId);
      if (poolIdx < pool.length && pool[poolIdx].placeId === candidate.placeId) {
        poolIdx++;
      }
    }
  }

  return mealSuggestions;
}

export function mergeSearchResults(
  poolFirst: GooglePoolSearchResult[],
  topUp: GooglePoolSearchResult[],
  limit: number
): GooglePoolSearchResult[] {
  const seen = new Set<string>();
  const merged: GooglePoolSearchResult[] = [];
  for (const place of [...poolFirst, ...topUp]) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    merged.push(place);
    if (merged.length >= limit) break;
  }
  return merged;
}

export interface SplitDestinationPoolResult {
  interestPool: GooglePoolSearchResult[];
  restaurantPool: GooglePoolSearchResult[];
  parksPool: GooglePoolSearchResult[];
  experiencesPool: GooglePoolSearchResult[];
  mealPools: Record<MealType, GooglePoolSearchResult[]>;
  counts: PoolCategoryCounts;
}

/** Split global pool rows into Generate fetch pool shapes. */
export function splitDestinationPoolIntoGeneratePools(
  rows: DestinationPoolRow[],
  interests: TripInterest[]
): SplitDestinationPoolResult {
  const sorted = sortPoolRows(rows);
  const interestPool: GooglePoolSearchResult[] = [];
  const restaurantPool: GooglePoolSearchResult[] = [];
  const parksPool: GooglePoolSearchResult[] = [];
  const experiencesPool: GooglePoolSearchResult[] = [];
  const breakfastTagged: GooglePoolSearchResult[] = [];
  const lunchTagged: GooglePoolSearchResult[] = [];
  const dinnerTagged: GooglePoolSearchResult[] = [];

  for (const row of sorted) {
    const mapped = mapPoolRowToSearchResult(row);

    if (row.is_park_nature || hasPoolTag(row, "park_nature")) {
      if (parksPool.length < GENERATE_POOL_LIMITS.parksPool) {
        parksPool.push(mapped);
      }
    }

    if (row.is_experience || hasPoolTag(row, "experience")) {
      if (experiencesPool.length < GENERATE_POOL_LIMITS.experiencesPool) {
        experiencesPool.push(mapped);
      }
    }

    if (
      hasPoolTag(row, "restaurant") ||
      row.primary_category === "restaurant" ||
      row.is_sit_down_restaurant
    ) {
      if (restaurantPool.length < GENERATE_POOL_LIMITS.restaurantPool) {
        restaurantPool.push(mapped);
      }
    }

    if (rowMatchesAnyInterest(row, interests)) {
      if (interestPool.length < GENERATE_POOL_LIMITS.interestPool) {
        interestPool.push(mapped);
      }
    }

    if (
      hasPoolTag(row, "breakfast") &&
      (row.is_sit_down_restaurant ||
        isSitDownRestaurant(row.name, row.google_types ?? []))
    ) {
      breakfastTagged.push(mapped);
    }
    if (
      hasPoolTag(row, "lunch") &&
      (row.is_sit_down_restaurant ||
        isSitDownRestaurant(row.name, row.google_types ?? []))
    ) {
      lunchTagged.push(mapped);
    }
    if (
      hasPoolTag(row, "dinner") &&
      (row.is_sit_down_restaurant ||
        isSitDownRestaurant(row.name, row.google_types ?? []))
    ) {
      dinnerTagged.push(mapped);
    }
  }

  const activitySightseeing = sorted.filter((row) =>
    rowMatchesActivitySightseeing(row, interests)
  ).length;

  return {
    interestPool,
    restaurantPool,
    parksPool,
    experiencesPool,
    mealPools: {
      breakfast: breakfastTagged,
      lunch: lunchTagged,
      dinner: dinnerTagged,
    },
    counts: {
      totalLoaded: rows.length,
      interestPool: interestPool.length,
      restaurantPool: restaurantPool.length,
      parksPool: parksPool.length,
      experiencesPool: experiencesPool.length,
      breakfastTagged: breakfastTagged.length,
      lunchTagged: lunchTagged.length,
      dinnerTagged: dinnerTagged.length,
      activitySightseeing,
    },
  };
}

export function assessPoolShortfalls(
  counts: PoolCategoryCounts,
  thresholds: GeneratePoolThresholds
): PoolShortfall[] {
  const shortfalls: PoolShortfall[] = [];

  const check = (category: string, have: number, need: number | null) => {
    if (need == null) return;
    if (have < need) shortfalls.push({ category, have, need });
  };

  check("breakfast", counts.breakfastTagged, thresholds.breakfast);
  check("lunch", counts.lunchTagged, thresholds.lunch);
  check("dinner", counts.dinnerTagged, thresholds.dinner);
  check("restaurant", counts.restaurantPool, thresholds.restaurant);
  check("activity_sightseeing", counts.activitySightseeing, thresholds.activitySightseeing);
  check("parks_nature", counts.parksPool, thresholds.parksNature);
  check("experiences", counts.experiencesPool, thresholds.experiences);

  return shortfalls;
}

export function loadGenerateCandidatePoolsFromDestinationPool(
  rows: DestinationPoolRow[],
  interests: TripInterest[],
  dates: string[]
): SplitDestinationPoolResult & { mealSuggestions: Map<string, GooglePoolSearchResult> } {
  const split = splitDestinationPoolIntoGeneratePools(rows, interests);
  const mealSuggestions = assignMealSuggestionsForDates(dates, split.mealPools);
  return { ...split, mealSuggestions };
}

export function logPoolRead(params: {
  slug: string | null;
  destinationId: string | null;
  globalCandidatesLoaded: number;
  counts: PoolCategoryCounts;
}): void {
  console.info("[candidate-pool] pool_read", params);
}

export function logPoolShortfall(params: {
  slug: string | null;
  shortfalls: PoolShortfall[];
}): void {
  console.info("[candidate-pool] pool_shortfall", params);
}

export function logPoolGoogleTopUp(params: {
  slug: string | null;
  topUpStats: PoolTopUpStats;
  googleFetchedCounts: Partial<Record<string, number>>;
}): void {
  console.info("[candidate-pool] google_top_up", params);
}

export function logPoolGenerateInputs(params: {
  slug: string | null;
  interestPoolCount: number;
  restaurantPoolCount: number;
  parksPoolCount: number;
  experiencesPoolCount: number;
  mealPrefetchSlots: number;
  fromGlobalPool: boolean;
}): void {
  console.info("[candidate-pool] pool_generate_inputs", params);
}

export function emptyGoogleTopUpPools(): GenerateFetchPools {
  return {
    interestPool: [],
    restaurantPool: [],
    parksPool: [],
    experiencesPool: [],
    mealSuggestions: new Map(),
  };
}

export interface TopUpMealsParams {
  lat: number;
  lng: number;
  city: string;
  dates: string[];
  excludeIds: string[];
  apiKey: string;
  quotaGate: PlacesQuotaGate;
  poolMealPools: Record<MealType, GooglePoolSearchResult[]>;
  thresholds: Pick<GeneratePoolThresholds, "breakfast" | "lunch" | "dinner">;
  topUpStats: PoolTopUpStats;
  googleTopUp: GenerateFetchPools;
}

/** Top up meal pools per tag when global inventory is below threshold. */
export async function topUpMealsFromGoogle(
  params: TopUpMealsParams,
  searchMealPlaces: (
    lat: number,
    lng: number,
    city: string,
    mealLabel: string,
    excludePlaceIds: string[],
    apiKey: string,
    needed: number,
    radius: number,
    quotaGate?: PlacesQuotaGate
  ) => Promise<GooglePoolSearchResult[]>
): Promise<{
  mealSuggestions: Map<string, GooglePoolSearchResult>;
  combinedMealPools: Record<MealType, GooglePoolSearchResult[]>;
}> {
  const {
    lat,
    lng,
    city,
    dates,
    excludeIds,
    apiKey,
    quotaGate,
    poolMealPools,
    thresholds,
    topUpStats,
    googleTopUp,
  } = params;

  const mealTypes: MealType[] = ["breakfast", "lunch", "dinner"];
  const combinedMealPools: Record<MealType, GooglePoolSearchResult[]> = {
    breakfast: [...poolMealPools.breakfast],
    lunch: [...poolMealPools.lunch],
    dinner: [...poolMealPools.dinner],
  };
  const growingExclude = [...excludeIds];

  for (const meal of mealTypes) {
    const threshold = thresholds[meal];
    const poolCount = poolMealPools[meal].length;
    const label = `meal_${meal}`;

    if (poolCount >= threshold) {
      topUpStats.skippedSufficient.push(label);
      for (const place of poolMealPools[meal]) {
        if (!growingExclude.includes(place.placeId)) {
          growingExclude.push(place.placeId);
        }
      }
      continue;
    }

    if (!quotaGate.allowLiveFetch()) {
      topUpStats.skippedQuota.push(label);
      for (const place of poolMealPools[meal]) {
        if (!growingExclude.includes(place.placeId)) {
          growingExclude.push(place.placeId);
        }
      }
      continue;
    }

    topUpStats.attemptedShort.push(label);
    const needed = Math.max(dates.length + 3, threshold - poolCount);
    const fetched = await searchMealPlaces(
      lat,
      lng,
      city,
      meal,
      growingExclude,
      apiKey,
      needed,
      meal === "lunch" ? 8000 : 5000,
      quotaGate
    );

    for (const place of fetched) {
      googleTopUp.mealSuggestions.set(`topup-${meal}-${place.placeId}`, place);
      if (!growingExclude.includes(place.placeId)) {
        growingExclude.push(place.placeId);
      }
    }

    combinedMealPools[meal] = mergeSearchResults(
      poolMealPools[meal],
      fetched,
      threshold + dates.length
    );
  }

  const mealSuggestions = assignMealSuggestionsForDates(dates, combinedMealPools);
  return { mealSuggestions, combinedMealPools };
}
