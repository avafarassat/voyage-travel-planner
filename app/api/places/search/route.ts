import { NextRequest, NextResponse } from "next/server";
import { googleTypeToCategory, type PlaceCategory } from "@/lib/types";

const CATEGORY_TYPES: Record<PlaceCategory, string> = {
  restaurant: "restaurant",
  bar: "bar",
  nightlife: "night_club",
  activity: "tourist_attraction",
  monument: "tourist_attraction",
  museum: "museum",
};

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lng = request.nextUrl.searchParams.get("lng");
  const category = request.nextUrl.searchParams.get("category") as PlaceCategory | null;
  const query = request.nextUrl.searchParams.get("query");

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  if (query) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    if (lat && lng) {
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", "5000");
    }
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    const results = (data.results ?? []).slice(0, 10).map((place: {
      place_id: string;
      name: string;
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
      rating?: number;
      types: string[];
      photos?: { photo_reference: string }[];
    }) => ({
      placeId: place.place_id,
      name: place.name,
      address: place.formatted_address,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      rating: place.rating,
      category: googleTypeToCategory(place.types, place.name),
      photoUrl: place.photos?.[0]
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
        : undefined,
      types: place.types,
    }));

    return NextResponse.json({ results });
  }

  if (!lat || !lng) {
    return NextResponse.json({ error: "lat/lng or query required" }, { status: 400 });
  }

  const type = category ? CATEGORY_TYPES[category] : "restaurant";
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "2000");
  url.searchParams.set("type", type);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  const results = (data.results ?? []).slice(0, 10).map((place: {
    place_id: string;
    name: string;
    vicinity: string;
    geometry: { location: { lat: number; lng: number } };
    rating?: number;
    types: string[];
    photos?: { photo_reference: string }[];
  }) => ({
    placeId: place.place_id,
    name: place.name,
    address: place.vicinity,
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    rating: place.rating,
    category: googleTypeToCategory(place.types, place.name),
    photoUrl: place.photos?.[0]
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
      : undefined,
    types: place.types,
  }));

  return NextResponse.json({ results });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { query, lat, lng, category } = body as {
    query?: string;
    lat?: number;
    lng?: number;
    category?: PlaceCategory;
  };

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  if (query) {
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    if (lat != null && lng != null) {
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", "5000");
    }
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    const results = (data.results ?? []).slice(0, 10).map((place: {
      place_id: string;
      name: string;
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
      rating?: number;
      types: string[];
      photos?: { photo_reference: string }[];
    }) => ({
      placeId: place.place_id,
      name: place.name,
      address: place.formatted_address,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      rating: place.rating,
      category: googleTypeToCategory(place.types, place.name),
      photoUrl: place.photos?.[0]
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
        : undefined,
      types: place.types,
    }));

    return NextResponse.json({ results });
  }

  if (lat == null || lng == null) {
    return NextResponse.json({ error: "query or lat/lng required" }, { status: 400 });
  }

  const type = category ? CATEGORY_TYPES[category] : "restaurant";
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", "2000");
  url.searchParams.set("type", type);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString());
  const data = await res.json();

  const results = (data.results ?? []).slice(0, 10).map((place: {
    place_id: string;
    name: string;
    vicinity: string;
    geometry: { location: { lat: number; lng: number } };
    rating?: number;
    types: string[];
    photos?: { photo_reference: string }[];
  }) => ({
    placeId: place.place_id,
    name: place.name,
    address: place.vicinity,
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    rating: place.rating,
    category: googleTypeToCategory(place.types, place.name),
    photoUrl: place.photos?.[0]
      ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${apiKey}`
      : undefined,
    types: place.types,
  }));

  return NextResponse.json({ results });
}
