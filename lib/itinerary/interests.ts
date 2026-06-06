import type { PlaceCategory } from "@/lib/types";

export type TripInterest =
  | "shopping"
  | "restaurants"
  | "bars_nightlife"
  | "activities"
  | "monuments"
  | "museums"
  | "food_markets"
  | "parks";

export const TRIP_INTERESTS: {
  id: TripInterest;
  label: string;
  emoji: string;
  description: string;
}[] = [
  { id: "shopping", label: "Shopping", emoji: "🛍️", description: "Markets, boutiques & malls" },
  { id: "restaurants", label: "Restaurants", emoji: "🍽️", description: "Local dining & cuisine" },
  { id: "bars_nightlife", label: "Bars & Nightlife", emoji: "🍸", description: "Cocktails, clubs & late nights" },
  { id: "activities", label: "Activities", emoji: "🎤", description: "Experiences & things to do" },
  { id: "monuments", label: "Monuments", emoji: "📍", description: "Landmarks & iconic sights" },
  { id: "museums", label: "Museums", emoji: "🏛️", description: "Art, history & culture" },
  { id: "food_markets", label: "Food Markets", emoji: "🥐", description: "Markets & street food" },
  { id: "parks", label: "Parks & Outdoors", emoji: "🌳", description: "Green spaces & walks" },
];

export const MIN_INTERESTS = 3;

/** Map trip interests to place categories used when fetching suggestions. */
export function interestToCategories(interest: TripInterest): PlaceCategory[] {
  switch (interest) {
    case "shopping":
      return ["activity"];
    case "restaurants":
    case "food_markets":
      return ["restaurant"];
    case "bars_nightlife":
      return ["bar", "nightlife"];
    case "activities":
    case "parks":
      return ["activity"];
    case "monuments":
      return ["monument"];
    case "museums":
      return ["museum"];
  }
}

/** Google nearby/text search type hints per interest. */
export function interestSearchQuery(interest: TripInterest, city: string): string {
  const queries: Record<TripInterest, string> = {
    shopping: `best shopping in ${city}`,
    restaurants: `top rated restaurants in ${city}`,
    bars_nightlife: `best bars and nightlife in ${city}`,
    activities: `best activities and experiences in ${city}`,
    monuments: `famous landmarks in ${city}`,
    museums: `best museums in ${city}`,
    food_markets: `food markets in ${city}`,
    parks: `best parks gardens and nature spots in ${city}`,
  };
  return queries[interest];
}
