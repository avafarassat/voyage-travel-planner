import type { OpeningHours, PlaceCategory, PlaceSearchResult, PoolTag, TripInterest } from "@/lib/types";
import {
  googleTypeToCategory,
  isExperienceActivity,
  isParkOrNaturePlace,
  isSitDownRestaurant,
} from "@/lib/types";
import type { MealType } from "@/lib/itinerary/hours";
import {
  candidateMatchesInterest,
  type InterestCandidate,
} from "@/lib/itinerary/interest-scheduling";

export type PoolDiscoverySource =
  | "interest_search"
  | "meal_search"
  | "restaurant_pool"
  | "parks_pool"
  | "experiences_pool";

export type GooglePoolSearchResult = PlaceSearchResult & {
  openingHours?: OpeningHours;
  userRatingsTotal?: number;
};

export interface MappedPoolCandidate {
  google_place_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  primary_category: PlaceCategory;
  pool_tags: PoolTag[];
  google_types: string[];
  rating: number | null;
  user_ratings_total: number | null;
  price_level: number | null;
  opening_hours: OpeningHours | null;
  is_sit_down_restaurant: boolean;
  is_experience: boolean;
  is_park_nature: boolean;
  quality_score: number;
  discovery_source: string;
}

function interestToPoolTags(interest: TripInterest): PoolTag[] {
  switch (interest) {
    case "shopping":
      return ["shopping"];
    case "restaurants":
      return ["restaurant"];
    case "food_markets":
      return ["food_market", "restaurant"];
    case "bars_nightlife":
      return ["bar", "nightlife"];
    case "activities":
      return ["experience"];
    case "monuments":
      return ["monument"];
    case "museums":
      return ["museum"];
    case "parks":
      return ["park_nature"];
  }
}

export function mergePoolTags(a: PoolTag[], b: PoolTag[]): PoolTag[] {
  return [...new Set([...a, ...b])];
}

export function computeQualityScore(
  rating?: number | null,
  userRatingsTotal?: number | null
): number {
  return (rating ?? 0) * 10 + (userRatingsTotal ?? 0) / 100;
}

export function interestTagsForResult(
  result: GooglePoolSearchResult,
  selectedInterests: TripInterest[]
): PoolTag[] {
  const types = result.types ?? [];
  const candidate: InterestCandidate = {
    name: result.name,
    category: result.category ?? googleTypeToCategory(types),
    outdoor: isParkOrNaturePlace(types, result.name),
    experience: isExperienceActivity(types, result.name),
  };
  const tags: PoolTag[] = [];
  for (const interest of selectedInterests) {
    if (candidateMatchesInterest(candidate, interest)) {
      for (const tag of interestToPoolTags(interest)) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }
  return tags;
}

export function mapGoogleResultToPoolCandidate(
  result: GooglePoolSearchResult,
  options: {
    discovery_source: PoolDiscoverySource | string;
    extraTags?: PoolTag[];
    interestTags?: PoolTag[];
    mealType?: MealType;
  }
): MappedPoolCandidate {
  const types = result.types ?? [];
  const name = result.name;
  const primary_category = result.category ?? googleTypeToCategory(types);
  const tags = new Set<PoolTag>();

  for (const tag of options.extraTags ?? []) tags.add(tag);
  for (const tag of options.interestTags ?? []) tags.add(tag);

  if (options.mealType) {
    tags.add(options.mealType);
    if (isSitDownRestaurant(name, types)) tags.add("restaurant");
  }

  switch (options.discovery_source) {
    case "restaurant_pool":
      tags.add("restaurant");
      break;
    case "parks_pool":
      tags.add("park_nature");
      break;
    case "experiences_pool":
      tags.add("experience");
      break;
    default:
      break;
  }

  if (primary_category === "museum") tags.add("museum");
  if (primary_category === "monument") tags.add("monument");
  if (primary_category === "bar") tags.add("bar");
  if (primary_category === "nightlife") tags.add("nightlife");
  if (primary_category === "restaurant" && !options.mealType) tags.add("restaurant");

  const is_experience = isExperienceActivity(types, name);
  const is_park_nature = isParkOrNaturePlace(types, name);
  const is_sit_down_restaurant = isSitDownRestaurant(name, types);

  return {
    google_place_id: result.placeId,
    name,
    address: result.address || null,
    lat: result.lat,
    lng: result.lng,
    primary_category,
    pool_tags: [...tags],
    google_types: types,
    rating: result.rating ?? null,
    user_ratings_total: result.userRatingsTotal ?? null,
    price_level: null,
    opening_hours: result.openingHours ?? null,
    is_sit_down_restaurant,
    is_experience,
    is_park_nature,
    quality_score: computeQualityScore(result.rating, result.userRatingsTotal),
    discovery_source: options.discovery_source,
  };
}

export function mergeMappedCandidates(
  a: MappedPoolCandidate,
  b: MappedPoolCandidate
): MappedPoolCandidate {
  const preferred = b.quality_score >= a.quality_score ? b : a;
  const other = preferred === b ? a : b;
  return {
    ...preferred,
    pool_tags: mergePoolTags(a.pool_tags, b.pool_tags),
    opening_hours: preferred.opening_hours ?? other.opening_hours,
    rating: preferred.rating ?? other.rating,
    user_ratings_total: preferred.user_ratings_total ?? other.user_ratings_total,
    is_sit_down_restaurant:
      a.is_sit_down_restaurant || b.is_sit_down_restaurant,
    is_experience: a.is_experience || b.is_experience,
    is_park_nature: a.is_park_nature || b.is_park_nature,
    quality_score: Math.max(a.quality_score, b.quality_score),
  };
}

export function mealTypeFromSuggestionKey(key: string): MealType | null {
  const suffix = key.slice(key.lastIndexOf("-") + 1);
  if (suffix === "breakfast" || suffix === "lunch" || suffix === "dinner") {
    return suffix;
  }
  return null;
}
