import type { HotelExploreResult } from "@/lib/maps/hotel-explore";
import { queryForHotelSearch } from "@/lib/maps/hotel-explore";

export const USE_MOCK_HOTEL_EXPLORE =
  process.env.NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE === "true";

export const HOTEL_SEARCH_UNAVAILABLE_MESSAGE =
  "Hotel search is temporarily unavailable. You can still enter your hotel manually.";

const MOCK_BARCELONA_HOTELS: HotelExploreResult[] = [
  {
    placeId: "mock-hotel-arts-barcelona",
    name: "Hotel Arts Barcelona",
    address: "Carrer de la Marina, 19-21, 08005 Barcelona, Spain",
    lat: 41.3868,
    lng: 2.1965,
    rating: 4.6,
    userRatingsTotal: 8241,
    priceLevel: 4,
  },
  {
    placeId: "mock-hotel-cotton-house",
    name: "Cotton House Hotel, Autograph Collection",
    address: "Gran Via de les Corts Catalanes, 670, 08010 Barcelona, Spain",
    lat: 41.3892,
    lng: 2.1683,
    rating: 4.8,
    userRatingsTotal: 2134,
    priceLevel: 4,
  },
  {
    placeId: "mock-hotel-neri",
    name: "Hotel Neri Relais & Châteaux",
    address: "Carrer de Sant Sever, 5, 08002 Barcelona, Spain",
    lat: 41.3831,
    lng: 2.1759,
    rating: 4.7,
    userRatingsTotal: 987,
    priceLevel: 3,
  },
  {
    placeId: "mock-hotel-praktik-rambla",
    name: "Praktik Rambla Boutique Hotel",
    address: "La Rambla, 27, 08002 Barcelona, Spain",
    lat: 41.3855,
    lng: 2.1732,
    rating: 4.4,
    userRatingsTotal: 1562,
    priceLevel: 2,
  },
  {
    placeId: "mock-hotel-axel",
    name: "Axel Hotel Barcelona",
    address: "Carrer d'Aribau, 33, 08011 Barcelona, Spain",
    lat: 41.3879,
    lng: 2.1625,
    rating: 4.3,
    userRatingsTotal: 3421,
    priceLevel: 2,
  },
];

const STOP_WORDS = new Set(["hotels", "hotel", "in", "the", "near", "and", "for"]);

export function friendlyHotelSearchError(raw?: string | null): string {
  if (!raw?.trim()) return HOTEL_SEARCH_UNAVAILABLE_MESSAGE;

  const lower = raw.toLowerCase();

  if (lower.includes("no hotels found")) return raw;
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
    return HOTEL_SEARCH_UNAVAILABLE_MESSAGE;
  }

  return HOTEL_SEARCH_UNAVAILABLE_MESSAGE;
}

export function isHotelSearchUnavailableError(message: string | null): boolean {
  return message === HOTEL_SEARCH_UNAVAILABLE_MESSAGE;
}

export function getMockHotelExploreResults(
  displayQuery: string,
  city: string,
  country?: string | null
): HotelExploreResult[] {
  const apiQuery = queryForHotelSearch(displayQuery, city, country).toLowerCase();
  const terms = apiQuery
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));

  if (terms.length === 0) return MOCK_BARCELONA_HOTELS;

  const filtered = MOCK_BARCELONA_HOTELS.filter((hotel) => {
    const haystack = `${hotel.name} ${hotel.address}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });

  return filtered.length > 0 ? filtered : MOCK_BARCELONA_HOTELS;
}
