export interface HotelExploreResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingsTotal?: number;
  priceLevel?: number;
}

export interface HotelExploreFilters {
  minRating: number;
  priceLevel: number | null;
}

export const DEFAULT_HOTEL_EXPLORE_FILTERS: HotelExploreFilters = {
  minRating: 0,
  priceLevel: null,
};

export function hasActiveHotelExploreFilters(filters: HotelExploreFilters): boolean {
  return filters.minRating > 0 || filters.priceLevel != null;
}

export function filterHotelExploreResults(
  results: HotelExploreResult[],
  filters: HotelExploreFilters
): HotelExploreResult[] {
  return results.filter((result) => {
    if (filters.minRating > 0) {
      if (result.rating == null || result.rating < filters.minRating) return false;
    }

    if (filters.priceLevel != null) {
      if (result.priceLevel == null || result.priceLevel !== filters.priceLevel) return false;
    }

    return true;
  });
}

function locationLabel(city: string, country?: string | null): string {
  return [city, country].filter(Boolean).join(", ");
}

export function defaultHotelExploreQuery(city: string, country?: string | null): string {
  const location = locationLabel(city, country);
  return location ? `hotels in ${location}` : "hotels";
}

export function queryForHotelSearch(
  displayQuery: string,
  city: string,
  country?: string | null
): string {
  const trimmed = displayQuery.trim();
  if (!trimmed) return "hotels";

  const location = locationLabel(city, country);
  if (!location) return trimmed;

  const suffix = ` in ${location}`;
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) {
    const stripped = trimmed.slice(0, -suffix.length).trim();
    return stripped || "hotels";
  }

  return trimmed;
}

export function exploreLocationLabel(city: string, country?: string | null): string {
  return locationLabel(city, country);
}
