import type { PlaceCategory, PoolTag } from "@/lib/types";
import { isExperienceActivity, isParkOrNaturePlace } from "@/lib/types";
import {
  MARKET_NAME_PATTERN,
  SHOPPING_NAME_PATTERN,
} from "@/lib/itinerary/interest-scheduling-patterns";

/** Visible trip-interest categories used in itinerary / My Places display. */
export type VisibleItineraryCategory =
  | "shopping"
  | "restaurant"
  | "bars_nightlife"
  | "activity"
  | "monument"
  | "museum"
  | "food_market"
  | "parks_outdoors";

export interface VisibleCategoryStyle {
  value: VisibleItineraryCategory;
  label: string;
  emoji: string;
  color: string;
}

export const VISIBLE_ITINERARY_CATEGORIES: VisibleCategoryStyle[] = [
  { value: "shopping", label: "Shopping", emoji: "🛍️", color: "#9333EA" },
  { value: "restaurant", label: "Restaurants", emoji: "🍽️", color: "#7B2D3B" },
  { value: "bars_nightlife", label: "Bars & Nightlife", emoji: "🍸", color: "#2563EB" },
  { value: "activity", label: "Activities", emoji: "🎤", color: "#CA8A04" },
  { value: "monument", label: "Monuments", emoji: "📍", color: "#166534" },
  { value: "museum", label: "Museums", emoji: "🏛️", color: "#EA580C" },
  { value: "food_market", label: "Food Markets", emoji: "🥐", color: "#B45309" },
  { value: "parks_outdoors", label: "Parks & Outdoors", emoji: "🌳", color: "#15803D" },
];

export interface VisibleCategoryInput {
  name?: string;
  category?: PlaceCategory | null;
  googleTypes?: string[];
  poolTags?: PoolTag[];
  isParkNature?: boolean;
  isExperience?: boolean;
}

const FOOD_MARKET_TYPES = new Set([
  "market",
  "grocery_or_supermarket",
  "supermarket",
  "convenience_store",
]);

const RESTAURANT_TYPES = new Set([
  "restaurant",
  "cafe",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
]);

const BAR_NIGHTLIFE_TYPES = new Set(["bar", "night_club", "liquor_store"]);

const SHOPPING_TYPES = new Set([
  "shopping_mall",
  "store",
  "clothing_store",
  "department_store",
  "shoe_store",
  "jewelry_store",
  "home_goods_store",
  "electronics_store",
  "book_store",
  "furniture_store",
]);

const MUSEUM_TYPES = new Set(["museum", "art_gallery"]);

const MONUMENT_TYPES = new Set([
  "tourist_attraction",
  "point_of_interest",
  "landmark",
  "church",
  "place_of_worship",
  "city_hall",
  "library",
]);

const PARK_TYPES = new Set([
  "park",
  "natural_feature",
  "campground",
  "national_park",
  "hiking_area",
  "garden",
  "beach",
]);

function hasType(types: string[], candidates: Set<string>): boolean {
  return types.some((t) => candidates.has(t));
}

function isFoodMarketName(name: string): boolean {
  return MARKET_NAME_PATTERN.test(name);
}

function isFoodMarket(types: string[], name: string): boolean {
  if (isFoodMarketName(name)) return true;
  if (hasType(types, FOOD_MARKET_TYPES)) return true;
  if (types.includes("food") && isFoodMarketName(name)) return true;
  return false;
}

function isParkOutdoors(types: string[], name: string, isParkNature?: boolean): boolean {
  if (isParkNature) return true;
  if (hasType(types, PARK_TYPES)) return true;
  return isParkOrNaturePlace(types, name);
}

function isShopping(types: string[], name: string): boolean {
  if (hasType(types, SHOPPING_TYPES)) return true;
  return SHOPPING_NAME_PATTERN.test(name);
}

function isMonumentCandidate(
  types: string[],
  name: string,
  category?: PlaceCategory | null
): boolean {
  if (category === "monument") return true;
  if (!hasType(types, MONUMENT_TYPES)) return false;
  if (isParkOutdoors(types, name)) return false;
  if (isFoodMarket(types, name)) return false;
  if (hasType(types, MUSEUM_TYPES)) return false;
  return true;
}

function hasMealOrRestaurantTag(tags: PoolTag[]): boolean {
  return tags.some((t) =>
    t === "restaurant" || t === "breakfast" || t === "lunch" || t === "dinner"
  );
}

/**
 * Map raw tags/types/name into the best visible itinerary category.
 * Specific categories (markets, parks, museums) win over generic monument/activity.
 */
export function resolveVisibleItineraryCategory(
  input: VisibleCategoryInput
): VisibleItineraryCategory {
  const name = input.name ?? "";
  const types = input.googleTypes ?? [];
  const tags = input.poolTags ?? [];
  const category = input.category ?? null;

  if (tags.includes("food_market") || isFoodMarket(types, name)) {
    return "food_market";
  }

  if (tags.includes("park_nature") || isParkOutdoors(types, name, input.isParkNature)) {
    return "parks_outdoors";
  }

  if (tags.includes("museum") || hasType(types, MUSEUM_TYPES) || category === "museum") {
    return "museum";
  }

  if (
    hasMealOrRestaurantTag(tags) ||
    hasType(types, RESTAURANT_TYPES) ||
    category === "restaurant"
  ) {
    return "restaurant";
  }

  if (
    tags.includes("bar") ||
    tags.includes("nightlife") ||
    hasType(types, BAR_NIGHTLIFE_TYPES) ||
    category === "bar" ||
    category === "nightlife"
  ) {
    return "bars_nightlife";
  }

  if (tags.includes("shopping") || isShopping(types, name)) {
    return "shopping";
  }

  if (
    tags.includes("experience") ||
    input.isExperience === true ||
    isExperienceActivity(types, name)
  ) {
    return "activity";
  }

  if (tags.includes("monument") || isMonumentCandidate(types, name, category)) {
    return "monument";
  }

  return "activity";
}

/** Scheduler/storage category derived from the visible category. */
export function visibleCategoryToPlaceCategory(
  visible: VisibleItineraryCategory
): PlaceCategory {
  switch (visible) {
    case "restaurant":
      return "restaurant";
    case "bars_nightlife":
      return "bar";
    case "monument":
      return "monument";
    case "museum":
      return "museum";
    case "shopping":
    case "food_market":
    case "parks_outdoors":
    case "activity":
    default:
      return "activity";
  }
}

/** Pin / legacy styling category closest to the visible category. */
export function visibleCategoryToPinCategory(
  visible: VisibleItineraryCategory
): PlaceCategory {
  switch (visible) {
    case "restaurant":
      return "restaurant";
    case "bars_nightlife":
      return "bar";
    case "monument":
      return "monument";
    case "museum":
      return "museum";
    case "shopping":
    case "food_market":
    case "parks_outdoors":
    case "activity":
    default:
      return "activity";
  }
}

export function getVisibleCategoryStyle(
  visible: VisibleItineraryCategory
): VisibleCategoryStyle {
  return (
    VISIBLE_ITINERARY_CATEGORIES.find((c) => c.value === visible) ??
    VISIBLE_ITINERARY_CATEGORIES.find((c) => c.value === "activity")!
  );
}

export function getPlaceDisplayStyle(input: VisibleCategoryInput): VisibleCategoryStyle {
  return getVisibleCategoryStyle(resolveVisibleItineraryCategory(input));
}

/** Google types + optional name → storage category for new places/candidates. */
export function googleTypesToPlaceCategory(types: string[], name = ""): PlaceCategory {
  return visibleCategoryToPlaceCategory(
    resolveVisibleItineraryCategory({ name, googleTypes: types })
  );
}

export function visibleCategoryToPoolTags(visible: VisibleItineraryCategory): PoolTag[] {
  switch (visible) {
    case "food_market":
      return ["food_market"];
    case "parks_outdoors":
      return ["park_nature"];
    case "museum":
      return ["museum"];
    case "monument":
      return ["monument"];
    case "restaurant":
      return ["restaurant"];
    case "bars_nightlife":
      return ["bar", "nightlife"];
    case "shopping":
      return ["shopping"];
    case "activity":
      return ["experience"];
  }
}
