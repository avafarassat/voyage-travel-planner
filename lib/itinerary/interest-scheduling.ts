import type { PlaceCategory } from "@/lib/types";
import type { TripInterest } from "@/lib/itinerary/interests";
import { MARKET_NAME_PATTERN, SHOPPING_NAME_PATTERN } from "@/lib/itinerary/interest-scheduling-patterns";

export type InterestCandidate = {
  name: string;
  category: PlaceCategory;
  outdoor?: boolean;
  experience?: boolean;
};

/** Interests scheduled via breakfast/lunch/dinner slots. */
export const MEAL_COVERED_INTERESTS: TripInterest[] = ["restaurants"];

/** Interests scheduled via post-dinner evening slots. */
export const EVENING_COVERED_INTERESTS: TripInterest[] = ["bars_nightlife"];

/** Interests picked in daytime activity / sightseeing slots. */
export const ACTIVITY_SLOT_INTERESTS: TripInterest[] = [
  "parks",
  "activities",
  "monuments",
  "museums",
  "shopping",
  "food_markets",
];

export function candidateMatchesInterest(
  candidate: InterestCandidate,
  interest: TripInterest
): boolean {
  switch (interest) {
    case "parks":
      return candidate.outdoor === true;
    case "activities":
      return (
        candidate.experience === true ||
        (candidate.category === "activity" &&
          !candidate.outdoor &&
          !SHOPPING_NAME_PATTERN.test(candidate.name) &&
          !MARKET_NAME_PATTERN.test(candidate.name))
      );
    case "monuments":
      return candidate.category === "monument";
    case "museums":
      return candidate.category === "museum";
    case "shopping":
      return (
        candidate.category === "activity" && SHOPPING_NAME_PATTERN.test(candidate.name)
      );
    case "food_markets":
      return MARKET_NAME_PATTERN.test(candidate.name);
    case "restaurants":
      return candidate.category === "restaurant";
    case "bars_nightlife":
      return candidate.category === "bar" || candidate.category === "nightlife";
    default:
      return false;
  }
}

export function interestsMatchedByCandidate(candidate: InterestCandidate): TripInterest[] {
  const matched: TripInterest[] = [];
  for (const interest of [
    ...ACTIVITY_SLOT_INTERESTS,
    ...MEAL_COVERED_INTERESTS,
    ...EVENING_COVERED_INTERESTS,
  ] as TripInterest[]) {
    if (candidateMatchesInterest(candidate, interest)) {
      matched.push(interest);
    }
  }
  return matched;
}

/** Rank which interest bucket to target next for an activity slot. */
export function rankActivityInterests(
  selectedInterests: TripInterest[],
  dayInterests: Set<TripInterest>,
  tripCounts: Map<TripInterest, number>,
  slotIndex = 0
): TripInterest[] {
  const eligible = ACTIVITY_SLOT_INTERESTS.filter((i) => selectedInterests.includes(i));
  if (eligible.length === 0) return [];

  const sorted = [...eligible].sort((a, b) => {
    const aOnDay = dayInterests.has(a) ? 1 : 0;
    const bOnDay = dayInterests.has(b) ? 1 : 0;
    if (aOnDay !== bOnDay) return aOnDay - bOnDay;

    const aCount = tripCounts.get(a) ?? 0;
    const bCount = tripCounts.get(b) ?? 0;
    if (aCount !== bCount) return aCount - bCount;

    return ACTIVITY_SLOT_INTERESTS.indexOf(a) - ACTIVITY_SLOT_INTERESTS.indexOf(b);
  });

  if (sorted.length <= 1) return sorted;

  const rotated = [
    ...sorted.slice(slotIndex % sorted.length),
    ...sorted.slice(0, slotIndex % sorted.length),
  ];
  return rotated;
}

export function registerInterestHits(
  tripCounts: Map<TripInterest, number>,
  dayInterests: Set<TripInterest>,
  interests: TripInterest[]
): void {
  for (const interest of interests) {
    tripCounts.set(interest, (tripCounts.get(interest) ?? 0) + 1);
    dayInterests.add(interest);
  }
}

export function initTripInterestCounts(interests: TripInterest[]): Map<TripInterest, number> {
  const counts = new Map<TripInterest, number>();
  for (const interest of interests) {
    counts.set(interest, 0);
  }
  return counts;
}
