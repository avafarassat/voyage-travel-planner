import type { OpeningHours, PlaceCategory, PlaceSearchResult } from "@/lib/types";
import { googleTypeToCategory, isExperienceActivity, isParkOrNaturePlace, isSitDownRestaurant } from "@/lib/types";
import { isRestaurantBrandUsed } from "@/lib/itinerary/meal-dedup";
import type { TripInterest } from "@/lib/itinerary/interests";
import { interestSearchQuery } from "@/lib/itinerary/interests";

function logPlacesApiStatus(
  context: string,
  data: { status?: string; error_message?: string }
): void {
  const status = data.status ?? "UNKNOWN";
  if (status === "OK" || status === "ZERO_RESULTS") return;
  console.warn("[google-places]", {
    context,
    status,
    ...(data.error_message ? { error_message: data.error_message } : {}),
  });
}

function mapLegacyPlace(place: {
  place_id: string;
  name: string;
  formatted_address?: string;
  vicinity?: string;
  geometry: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  types: string[];
  photos?: { photo_reference: string }[];
  opening_hours?: OpeningHours;
}): PlaceSearchResult & { openingHours?: OpeningHours; userRatingsTotal?: number } {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  return {
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address ?? place.vicinity ?? "",
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    rating: place.rating,
    category: googleTypeToCategory(place.types),
    photoUrl: place.photos?.[0]
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
      : undefined,
    types: place.types,
    openingHours: place.opening_hours,
    userRatingsTotal: place.user_ratings_total,
  };
}

export interface PlaceDetailProfile {
  name: string;
  address: string;
  rating?: number;
  userRatingsTotal?: number;
  photoUrls: string[];
  reviews: { author: string; rating: number; text: string; relativeTime?: string }[];
  openingHours?: OpeningHours;
  googleMapsUrl?: string;
  types: string[];
}

export async function fetchPlaceDetailProfile(
  googlePlaceId: string,
  apiKey: string
): Promise<PlaceDetailProfile | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", googlePlaceId);
  url.searchParams.set(
    "fields",
    "place_id,name,formatted_address,rating,user_ratings_total,photos,reviews,opening_hours,url,types"
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "OK" || !data.result) return null;

  const result = data.result as {
    name: string;
    formatted_address?: string;
    rating?: number;
    user_ratings_total?: number;
    photos?: { photo_reference: string }[];
    reviews?: {
      author_name: string;
      rating: number;
      text: string;
      relative_time_description?: string;
    }[];
    opening_hours?: OpeningHours;
    url?: string;
    types?: string[];
  };

  return {
    name: result.name,
    address: result.formatted_address ?? "",
    rating: result.rating,
    userRatingsTotal: result.user_ratings_total,
    photoUrls: (result.photos ?? []).slice(0, 5).map(
      (p) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${p.photo_reference}&key=${apiKey}`
    ),
    reviews: (result.reviews ?? []).slice(0, 5).map((r) => ({
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      relativeTime: r.relative_time_description,
    })),
    openingHours: result.opening_hours,
    googleMapsUrl: result.url,
    types: result.types ?? [],
  };
}

export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<{ openingHours?: OpeningHours; rating?: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set(
    "fields",
    "opening_hours,rating,user_ratings_total"
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "OK" || !data.result) return null;

  return {
    openingHours: data.result.opening_hours,
    rating: data.result.rating,
  };
}

export async function fetchTopSuggestions(
  lat: number,
  lng: number,
  city: string,
  interests: TripInterest[],
  excludePlaceIds: string[],
  apiKey: string,
  limit = 30
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours })[]> {
  const seen = new Set(excludePlaceIds);
  const results: (PlaceSearchResult & { openingHours?: OpeningHours; score: number })[] = [];

  const interestResults = await Promise.all(
    interests.map(async (interest) => {
      const query = interestSearchQuery(interest, city);
      const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      url.searchParams.set("query", query);
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", "8000");
      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();
      logPlacesApiStatus(`fetchTopSuggestions: ${query}`, data);
      return (data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][];
    })
  );

  for (const places of interestResults) {
    for (const place of places.slice(0, 8)) {
      if (seen.has(place.place_id)) continue;
      seen.add(place.place_id);
      const mapped = mapLegacyPlace(place);
      const score =
        (mapped.rating ?? 0) * 10 + (mapped.userRatingsTotal ?? 0) / 100;
      results.push({ ...mapped, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

/** Dedicated pool of parks, gardens, and outdoor/nature spots for itinerary variety. */
export async function fetchParksAndNaturePool(
  lat: number,
  lng: number,
  city: string,
  excludePlaceIds: string[],
  apiKey: string,
  limit = 30
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours })[]> {
  const seen = new Set(excludePlaceIds);
  const results: (PlaceSearchResult & {
    openingHours?: OpeningHours;
    score: number;
  })[] = [];

  const addPlace = (place: Parameters<typeof mapLegacyPlace>[0], bonus = 0) => {
    if (seen.has(place.place_id)) return;
    const mapped = mapLegacyPlace(place);
    if (mapped.category === "restaurant" || mapped.category === "bar") return;
    if (!isParkOrNaturePlace(place.types ?? [], place.name)) return;
    seen.add(place.place_id);
    const score =
      (mapped.rating ?? 0) * 10 + (mapped.userRatingsTotal ?? 0) / 100 + bonus;
    results.push({ ...mapped, score });
  };

  const nearbyUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  nearbyUrl.searchParams.set("location", `${lat},${lng}`);
  nearbyUrl.searchParams.set("radius", "12000");
  nearbyUrl.searchParams.set("type", "park");
  nearbyUrl.searchParams.set("key", apiKey);

  const nearbyRes = await fetch(nearbyUrl.toString());
  const nearbyData = await nearbyRes.json();
  logPlacesApiStatus("fetchParksAndNaturePool: nearby park search", nearbyData);
  for (const place of ((nearbyData.results ?? []) as Parameters<typeof mapLegacyPlace>[0][]).slice(
    0,
    15
  )) {
    addPlace(place, 5);
  }

  const queries = [
    `best parks in ${city}`,
    `gardens and green spaces ${city}`,
    `nature walks and viewpoints ${city}`,
  ];

  for (const query of queries) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", "12000");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();
    logPlacesApiStatus(`fetchParksAndNaturePool: ${query}`, data);
    for (const place of ((data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][]).slice(
      0,
      10
    )) {
      addPlace(place);
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

/** Tours, cooking classes, food walks, tastings, and other bookable experiences. */
export async function fetchExperiencesPool(
  lat: number,
  lng: number,
  city: string,
  excludePlaceIds: string[],
  apiKey: string,
  limit = 30
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours })[]> {
  const seen = new Set(excludePlaceIds);
  const results: (PlaceSearchResult & {
    openingHours?: OpeningHours;
    score: number;
  })[] = [];

  const addPlace = (place: Parameters<typeof mapLegacyPlace>[0], bonus = 0) => {
    if (seen.has(place.place_id)) return;
    const mapped = mapLegacyPlace(place);
    if (mapped.category === "nightlife") return;
    if (
      mapped.category === "restaurant" &&
      !/tour|class|tasting|experience|workshop|crawl|walk/i.test(place.name)
    ) {
      return;
    }
    if (!isExperienceActivity(place.types ?? [], place.name)) return;
    seen.add(place.place_id);
    const score =
      (mapped.rating ?? 0) * 10 + (mapped.userRatingsTotal ?? 0) / 100 + bonus;
    results.push({ ...mapped, score });
  };

  const queries = [
    `cooking class ${city}`,
    `food tour ${city}`,
    `walking tour ${city}`,
    `tapas tour ${city}`,
    `wine tasting experience ${city}`,
    `guided tours and activities ${city}`,
    `popular experiences ${city}`,
  ];

  for (const query of queries) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", "12000");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();
    logPlacesApiStatus(`fetchExperiencesPool: ${query}`, data);
    for (const place of ((data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][]).slice(
      0,
      8
    )) {
      addPlace(place, query.includes("cooking") || query.includes("food tour") ? 3 : 0);
    }
  }

  const agencyUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  agencyUrl.searchParams.set("location", `${lat},${lng}`);
  agencyUrl.searchParams.set("radius", "8000");
  agencyUrl.searchParams.set("type", "travel_agency");
  agencyUrl.searchParams.set("keyword", `tours ${city}`);
  agencyUrl.searchParams.set("key", apiKey);

  const agencyRes = await fetch(agencyUrl.toString());
  const agencyData = await agencyRes.json();
  logPlacesApiStatus("fetchExperiencesPool: nearby travel_agency search", agencyData);
  for (const place of (
    (agencyData.results ?? []) as Parameters<typeof mapLegacyPlace>[0][]
  ).slice(0, 10)) {
    addPlace(place, 2);
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

async function searchMealPlaces(
  lat: number,
  lng: number,
  city: string,
  mealLabel: string,
  excludePlaceIds: string[],
  apiKey: string,
  needed = 1,
  radius = 5000
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours })[]> {
  const queries = [
    `best ${mealLabel} restaurant in ${city}`,
    `${mealLabel} ${city}`,
    `highly rated ${mealLabel} near ${city}`,
  ];

  const excluded = new Set(excludePlaceIds);
  const picked: (PlaceSearchResult & { openingHours?: OpeningHours })[] = [];

  for (const query of queries) {
    if (picked.length >= needed) break;

    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();
    logPlacesApiStatus(`searchMealPlaces: ${mealLabel} — ${query}`, data);
    const places = (data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][];

    for (const place of places) {
      if (picked.length >= needed) break;
      if (excluded.has(place.place_id)) continue;
      if ((place.rating ?? 0) < 3.5) continue;
      if (!isSitDownRestaurant(place.name, place.types ?? [])) continue;
      excluded.add(place.place_id);
      picked.push(mapLegacyPlace(place));
    }
  }

  return picked;
}

/** One search per meal type; assign unique restaurants across trip dates. */
export async function fetchMealsForDates(
  lat: number,
  lng: number,
  city: string,
  dates: string[],
  excludePlaceIds: string[],
  apiKey: string
): Promise<Map<string, PlaceSearchResult & { openingHours?: OpeningHours }>> {
  const mealTypes = ["breakfast", "lunch", "dinner"] as const;
  const needed = dates.length;
  const growingExclude = [...excludePlaceIds];

  const mealSuggestions = new Map<
    string,
    PlaceSearchResult & { openingHours?: OpeningHours }
  >();

  // Sequential so each meal type excludes picks from prior types (parallel caused duplicates).
  for (const meal of mealTypes) {
    const pool = await searchMealPlaces(
      lat,
      lng,
      city,
      meal,
      growingExclude,
      apiKey,
      needed + 3,
      meal === "lunch" ? 8000 : 5000
    );
    for (const place of pool) {
      growingExclude.push(place.placeId);
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

/** Multiple meal candidates via shared text-search pool (brand/exclude filtered). */
export async function fetchMealSuggestionCandidates(
  lat: number,
  lng: number,
  city: string,
  mealLabel: string,
  excludePlaceIds: string[],
  apiKey: string,
  excludeBrandKeys: string[] = [],
  limit = 8
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours })[]> {
  const pool = await searchMealPlaces(
    lat,
    lng,
    city,
    mealLabel,
    excludePlaceIds,
    apiKey,
    limit,
    mealLabel === "lunch" ? 8000 : 5000
  );
  const usedBrands = new Set(excludeBrandKeys);
  const candidates: (PlaceSearchResult & { openingHours?: OpeningHours })[] = [];

  for (const place of pool) {
    if (!isSitDownRestaurant(place.name, place.types ?? [])) continue;
    if (isRestaurantBrandUsed(place.name, usedBrands)) continue;
    candidates.push(place);
  }

  return candidates;
}

export async function fetchMealSuggestion(
  lat: number,
  lng: number,
  city: string,
  mealLabel: string,
  excludePlaceIds: string[],
  apiKey: string,
  excludeBrandKeys: string[] = []
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours }) | null> {
  const candidates = await fetchMealSuggestionCandidates(
    lat,
    lng,
    city,
    mealLabel,
    excludePlaceIds,
    apiKey,
    excludeBrandKeys,
    1
  );
  return candidates[0] ?? null;
}

/** Fetch photo (and google id when missing) for a saved place. */
export async function resolvePlacePhoto(
  place: {
    name: string;
    lat: number;
    lng: number;
    google_place_id?: string | null;
  },
  city: string,
  apiKey: string
): Promise<{ photoUrl: string | null; googlePlaceId?: string } | null> {
  if (place.google_place_id) {
    const details = await fetchPlaceByGoogleId(place.google_place_id, apiKey);
    if (!details) return null;
    return {
      photoUrl: details.photoUrl ?? null,
      googlePlaceId: place.google_place_id,
    };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `${place.name} ${city}`);
  url.searchParams.set("location", `${place.lat},${place.lng}`);
  url.searchParams.set("radius", "800");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  const results = (data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][];

  let best: (typeof results)[0] | null = null;
  let bestDist = Infinity;
  for (const candidate of results) {
    const dist = Math.hypot(
      candidate.geometry.location.lat - place.lat,
      candidate.geometry.location.lng - place.lng
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  if (!best || bestDist > 0.015) return null;

  const mapped = mapLegacyPlace(best);
  return {
    photoUrl: mapped.photoUrl ?? null,
    googlePlaceId: mapped.placeId,
  };
}

export async function fetchPlaceByGoogleId(
  googlePlaceId: string,
  apiKey: string
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours }) | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", googlePlaceId);
  url.searchParams.set(
    "fields",
    "place_id,name,formatted_address,geometry,rating,photos,types,opening_hours"
  );
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.status !== "OK" || !data.result) return null;

  const place = data.result as {
    place_id: string;
    name: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
    rating?: number;
    types: string[];
    photos?: { photo_reference: string }[];
    opening_hours?: OpeningHours;
  };

  return mapLegacyPlace(place);
}

export async function fetchAlternativeSuggestion(
  lat: number,
  lng: number,
  city: string,
  category: PlaceCategory,
  excludePlaceIds: string[],
  apiKey: string,
  excludeBrandKeys: string[] = []
): Promise<(PlaceSearchResult & { openingHours?: OpeningHours }) | null> {
  const labels: Record<PlaceCategory, string> = {
    restaurant: "restaurant",
    bar: "cocktail bar",
    nightlife: "nightclub",
    activity: "things to do",
    monument: "landmark",
    museum: "museum",
  };

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", `top rated ${labels[category]} in ${city}`);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "5000");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();
  const places = (data.results ?? []) as Parameters<typeof mapLegacyPlace>[0][];
  const usedBrands = new Set(excludeBrandKeys);

  for (const place of places) {
    if (excludePlaceIds.includes(place.place_id)) continue;
    if (
      category === "restaurant" &&
      isRestaurantBrandUsed(place.name, usedBrands)
    ) {
      continue;
    }
    return mapLegacyPlace(place);
  }

  return null;
}
