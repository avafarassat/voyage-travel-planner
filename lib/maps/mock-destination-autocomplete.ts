import type { AutocompleteSelection } from "@/components/trip/place-autocomplete-input";

export const USE_MOCK_DESTINATION_AUTOCOMPLETE =
  process.env.NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE === "true";

export const DESTINATION_SEARCH_UNAVAILABLE_MESSAGE =
  "Destination search is temporarily unavailable. You can still enter the city and country manually.";

const MOCK_DESTINATIONS: AutocompleteSelection[] = [
  {
    placeId: "mock-destination-lake-como",
    name: "Lake Como",
    address: "Lombardy, Italy",
    lat: 46.016,
    lng: 9.2572,
  },
  {
    placeId: "mock-destination-florence",
    name: "Florence",
    address: "Tuscany, Italy",
    lat: 43.7696,
    lng: 11.2558,
  },
  {
    placeId: "mock-destination-paris",
    name: "Paris",
    address: "France",
    lat: 48.8566,
    lng: 2.3522,
  },
  {
    placeId: "mock-destination-barcelona",
    name: "Barcelona",
    address: "Catalonia, Spain",
    lat: 41.3851,
    lng: 2.1734,
  },
  {
    placeId: "mock-destination-tokyo",
    name: "Tokyo",
    address: "Japan",
    lat: 35.6762,
    lng: 139.6503,
  },
  {
    placeId: "mock-destination-new-york",
    name: "New York",
    address: "NY, United States",
    lat: 40.7128,
    lng: -74.006,
  },
];

export function friendlyDestinationSearchError(raw?: string | null): string {
  if (!raw?.trim()) return DESTINATION_SEARCH_UNAVAILABLE_MESSAGE;

  const lower = raw.toLowerCase();

  if (lower.includes("no matches")) return raw;
  if (lower.includes("could not search") || lower.includes("check your connection")) {
    return raw;
  }

  if (
    lower.includes("quota") ||
    lower.includes("over_query_limit") ||
    lower.includes("exceeded") ||
    lower.includes("request denied") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("search failed") ||
    lower.includes("not configured") ||
    lower.includes("billing") ||
    lower.includes("google")
  ) {
    return DESTINATION_SEARCH_UNAVAILABLE_MESSAGE;
  }

  return DESTINATION_SEARCH_UNAVAILABLE_MESSAGE;
}

export function getMockDestinationResults(query: string): AutocompleteSelection[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];

  const terms = normalized.split(/\s+/).filter(Boolean);

  return MOCK_DESTINATIONS.filter((destination) => {
    const haystack = `${destination.name} ${destination.address}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
