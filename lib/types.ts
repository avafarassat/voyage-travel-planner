export type PlaceCategory =
  | "restaurant"
  | "bar"
  | "nightlife"
  | "activity"
  | "monument"
  | "museum";

export type TransportType =
  | "car_rental"
  | "shuttle"
  | "train"
  | "rideshare"
  | "bus"
  | "other";

export type PlaceSource = "manual" | "suggested";

export type StopType = "place" | "meal" | "rest";

export type MealType = "breakfast" | "lunch" | "dinner";

/** Global lifecycle for a row in destination_place_candidates (shared inventory). */
export type CandidateGlobalStatus = "active" | "retired" | "pending_refresh";

/** Per-trip scheduler state for a candidate in trip_candidate_pool. */
export type TripCandidateStatus =
  | "available"
  | "placed"
  | "rejected"
  | "removed_by_user"
  | "reserved";

/** Why a trip candidate was rejected during scheduling (trip_candidate_pool). */
export type CandidateRejectionReason =
  | "opening_hours"
  | "proximity"
  | "duplicate_brand"
  | "duplicate_day"
  | "scheduler_failed"
  | "user_dismissed"
  | "low_quality";

/**
 * Scheduling role tags on pool rows (multi-valued).
 * Distinct from primary_category / PlaceCategory — e.g. a restaurant may tag lunch + dinner.
 */
export type PoolTag =
  | "breakfast"
  | "lunch"
  | "dinner"
  | "restaurant"
  | "museum"
  | "monument"
  | "shopping"
  | "nightlife"
  | "bar"
  | "park_nature"
  | "experience"
  | "food_market";

export type TripInterest =
  | "shopping"
  | "restaurants"
  | "bars_nightlife"
  | "activities"
  | "monuments"
  | "museums"
  | "food_markets"
  | "parks";

export interface OpeningHours {
  periods?: {
    open: { day: number; time: string };
    close?: { day: number; time: string };
  }[];
  weekday_text?: string[];
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  city: string;
  country: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string;
  end_date: string;
  cover_image_url: string | null;
  share_token: string | null;
  is_public: boolean;
  interests: TripInterest[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface Hotel {
  id: string;
  trip_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
  created_at: string;
}

export interface Place {
  /** Trip-scoped saved venue (manual My Places or suggested stop backing row). Not shared inventory. */
  id: string;
  trip_id: string;
  name: string;
  category: PlaceCategory;
  address: string | null;
  lat: number;
  lng: number;
  notes: string | null;
  source: PlaceSource;
  google_place_id: string | null;
  rating: number | null;
  photo_url: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
  opening_hours: OpeningHours | null;
  created_at: string;
}

/**
 * Shared destination registry (city/region). One row per normalized destination slug.
 * Populated and refreshed by server-side pool jobs — not trip-scoped.
 */
export interface Destination {
  id: string;
  slug: string;
  city: string;
  country: string | null;
  center_lat: number | null;
  center_lng: number | null;
  google_place_id: string | null;
  last_pool_refresh_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Shared destination-level candidate inventory keyed by google_place_id.
 * Reused across trips to the same destination. No photo URLs stored here.
 * Contrast with Place, which is trip-scoped and may include user-specific fields.
 */
export interface DestinationPlaceCandidate {
  id: string;
  destination_id: string;
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
  global_status: CandidateGlobalStatus;
  permanently_closed: boolean;
  discovered_at: string;
  last_refreshed_at: string;
  last_seen_at: string;
  discovery_source: string | null;
}

/**
 * Per-trip candidate deck: snapshot + scheduler state for one Generate/regenerate run.
 * Tracks available / placed / rejected candidates for a trip without mutating global inventory.
 */
export interface TripCandidatePoolEntry {
  id: string;
  trip_id: string;
  destination_candidate_id: string | null;
  google_place_id: string;
  name: string;
  lat: number;
  lng: number;
  primary_category: PlaceCategory;
  pool_tags: PoolTag[];
  opening_hours: OpeningHours | null;
  rating: number | null;
  status: TripCandidateStatus;
  rejection_reason: CandidateRejectionReason | null;
  placed_stop_id: string | null;
  placed_day_id: string | null;
  generation_run_id: string;
  created_at: string;
  updated_at: string;
}

export interface Flight {
  id: string;
  trip_id: string;
  airline: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  confirmation_code: string | null;
  notes: string | null;
  boarding_pass_url: string | null;
  status: string | null;
  status_updated_at: string | null;
  created_at: string;
}

export interface TransportBooking {
  id: string;
  trip_id: string;
  type: TransportType;
  title: string;
  pickup_location: string | null;
  dropoff_location: string | null;
  pickup_time: string | null;
  dropoff_time: string | null;
  confirmation_code: string | null;
  notes: string | null;
  created_at: string;
}

export interface ItineraryDay {
  id: string;
  trip_id: string;
  day_number: number;
  date: string;
  created_at: string;
}

export interface ItineraryStop {
  id: string;
  itinerary_day_id: string;
  place_id: string | null;
  sort_order: number;
  stop_type: StopType;
  meal_type: MealType | null;
  title: string | null;
  duration_minutes: number | null;
  scheduled_time: string | null;
  suggestion_key: string | null;
  is_suggested: boolean;
  is_completed?: boolean;
  created_at: string;
  place?: Place;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  photoUrl?: string;
  types: string[];
  category?: PlaceCategory;
  openingHours?: OpeningHours;
}

export interface DirectionLeg {
  fromPlaceId: string;
  toPlaceId: string;
  durationText: string;
  durationSeconds: number;
  distanceText: string;
  mode: "WALKING" | "TRANSIT" | "DRIVING";
}

export const PLACE_CATEGORIES: {
  value: PlaceCategory;
  label: string;
  color: string;
  emoji: string;
}[] = [
  { value: "restaurant", label: "Restaurant", color: "#7B2D3B", emoji: "🍽️" },
  { value: "bar", label: "Bar", color: "#2563EB", emoji: "🍸" },
  { value: "nightlife", label: "Nightlife", color: "#DB2777", emoji: "🪩" },
  { value: "activity", label: "Activity", color: "#CA8A04", emoji: "🎤" },
  { value: "monument", label: "Monument", color: "#166534", emoji: "📍" },
  { value: "museum", label: "Museum", color: "#EA580C", emoji: "🏛️" },
];

export const TRANSPORT_TYPES: { value: TransportType; label: string; emoji: string }[] = [
  { value: "car_rental", label: "Car Rental", emoji: "🚗" },
  { value: "shuttle", label: "Shuttle", emoji: "🚐" },
  { value: "train", label: "Train", emoji: "🚆" },
  { value: "rideshare", label: "Rideshare", emoji: "🚕" },
  { value: "bus", label: "Bus", emoji: "🚌" },
  { value: "other", label: "Other", emoji: "✈️" },
];

export function getCategoryStyle(category: PlaceCategory) {
  return PLACE_CATEGORIES.find((c) => c.value === category) ?? PLACE_CATEGORIES[0];
}

export function googleTypeToCategory(types: string[]): PlaceCategory {
  if (types.includes("restaurant") || types.includes("food")) return "restaurant";
  if (types.includes("night_club")) return "nightlife";
  if (types.includes("bar")) return "bar";
  if (types.includes("museum")) return "museum";
  if (types.includes("tourist_attraction")) return "monument";
  if (
    types.some((t) =>
      ["park", "natural_feature", "campground", "national_park", "hiking_area"].includes(t)
    )
  ) {
    return "activity";
  }
  return "activity";
}

/** True for parks, gardens, beaches, and other outdoor/nature spots. */
export function isParkOrNaturePlace(types: string[], name: string): boolean {
  if (
    types.some((t) =>
      [
        "park",
        "natural_feature",
        "campground",
        "national_park",
        "hiking_area",
        "beach",
      ].includes(t)
    )
  ) {
    return true;
  }
  return /park|parc|jard[ií]|garden|nature|beach|playa|monte|forest|trail|sendero|mirador|lookout|hiking|aigües|aigues|passeig|ruta|camí|camino/i.test(
    name
  );
}

/** Sit-down dining only — excludes tours, tastings, and other experience venues. */
export function isSitDownRestaurant(name: string, types: string[] = []): boolean {
  return !isExperienceActivity(types, name);
}

/** Bookable experiences: tours, classes, tastings, workshops — not sit-down dining. */
export function isExperienceActivity(types: string[], name: string): boolean {
  if (types.includes("travel_agency")) return true;
  if (
    (types.includes("restaurant") || types.includes("food") || types.includes("bar")) &&
    !/tour|class|tasting|experience|workshop|crawl|walk/i.test(name)
  ) {
    return false;
  }
  return /\btours?\b|cooking class|culinary class|food tour|walking tour|guided tour|tapas tour|wine tasting|tasting experience|market tour|bike tour|segway|workshop|paella class|sailing tour|boat tour|kayak|food walk|restaurant tour|bar crawl|flamenco show|masterclass|day trip|experience|activities and/i.test(
    name
  );
}

export function getTripDayCount(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

export function getTripDates(startDate: string, endDate: string): string[] {
  const days = getTripDayCount(startDate, endDate);
  const dates: string[] = [];
  const start = new Date(startDate);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
