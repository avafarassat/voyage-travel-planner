interface PlaceResult {
  place_id: string;
  photos?: { photo_reference: string }[];
  user_ratings_total?: number;
  name?: string;
  types?: string[];
}

interface PhotoWithDimensions {
  photo_reference: string;
  width: number;
  height: number;
}

const FOOD_LODGING_TYPES = new Set([
  "restaurant",
  "food",
  "cafe",
  "bar",
  "night_club",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "lodging",
  "hotel",
]);

const NON_LANDMARK_TYPES = new Set([
  "locality",
  "political",
  "neighborhood",
  "route",
  "street_address",
  "store",
  "shopping_mall",
]);

const LANDMARK_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "church",
  "place_of_worship",
  "art_gallery",
  "park",
  "natural_feature",
  "landmark",
  "point_of_interest",
]);

/** Card banner is roughly 2:1 — pick photos near that ratio, not ultra-wide food shots. */
const BANNER_ASPECT = 2;

function photoUrlFromReference(photoReference: string, apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
  url.searchParams.set("maxwidth", "640");
  url.searchParams.set("photo_reference", photoReference);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

function isLandmarkPlace(types: string[] | undefined): boolean {
  if (!types?.length) return false;
  if (types.some((t) => FOOD_LODGING_TYPES.has(t))) return false;
  if (!types.some((t) => LANDMARK_TYPES.has(t))) return false;
  if (types.every((t) => NON_LANDMARK_TYPES.has(t) || FOOD_LODGING_TYPES.has(t))) {
    return false;
  }
  return true;
}

function rankLandmarks(places: PlaceResult[]): PlaceResult[] {
  return places
    .filter((p) => p.place_id && isLandmarkPlace(p.types))
    .sort((a, b) => (b.user_ratings_total ?? 0) - (a.user_ratings_total ?? 0));
}

async function searchPlaces(
  query: string,
  apiKey: string,
  type?: string
): Promise<PlaceResult[]> {
  const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("key", apiKey);
  if (type) searchUrl.searchParams.set("type", type);

  const res = await fetch(searchUrl.toString());
  const data = await res.json();

  if (data.status !== "OK" || !data.results?.length) return [];
  return data.results;
}

async function fetchPlacePhotos(
  placeId: string,
  apiKey: string
): Promise<PhotoWithDimensions[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "photos,types");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.status !== "OK") return [];

  const types: string[] = data.result?.types ?? [];
  if (!isLandmarkPlace(types)) return [];

  if (!data.result?.photos?.length) return [];

  return data.result.photos
    .filter(
      (p: { width?: number; height?: number; photo_reference?: string }) =>
        p.width && p.height && p.photo_reference
    )
    .map((p: { width: number; height: number; photo_reference: string }) => ({
      photo_reference: p.photo_reference,
      width: p.width,
      height: p.height,
    }));
}

/** Prefer ~2:1 landscape shots that fit the banner; avoid ultra-wide random photos. */
function pickBannerPhoto(photos: PhotoWithDimensions[]): string | null {
  if (!photos.length) return null;

  const scored = photos.map((p) => {
    const aspect = p.width / p.height;
    const landscapeBonus = aspect >= 1.2 ? 0 : -5;
    const aspectFit = -Math.abs(aspect - BANNER_ASPECT);
    return { ref: p.photo_reference, score: landscapeBonus + aspectFit };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].ref;
}

async function bestLandmarkCover(
  places: PlaceResult[],
  apiKey: string
): Promise<string | null> {
  const ranked = rankLandmarks(places);

  for (const place of ranked.slice(0, 5)) {
    const photos = await fetchPlacePhotos(place.place_id, apiKey);
    const ref = pickBannerPhoto(photos);
    if (ref) return photoUrlFromReference(ref, apiKey);
  }

  return null;
}

/** Fetch a landscape cover photo of a well-known landmark for the destination. */
export async function fetchCityCoverImage(
  city: string,
  country: string | null,
  apiKey: string
): Promise<string | null> {
  const location = [city, country].filter(Boolean).join(", ");

  const queries = [
    { query: `famous landmark ${location}`, type: "tourist_attraction" },
    { query: `iconic monument ${location}`, type: "tourist_attraction" },
    { query: `top tourist attraction ${location}`, type: "tourist_attraction" },
    { query: `${location} landmark`, type: "tourist_attraction" },
  ];

  for (const { query, type } of queries) {
    const places = await searchPlaces(query, apiKey, type);
    const url = await bestLandmarkCover(places, apiKey);
    if (url) return url;
  }

  return null;
}
