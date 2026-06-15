import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isAllowedGooglePhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "maps.googleapis.com") {
      return parsed.pathname === "/maps/api/place/photo";
    }
    if (parsed.hostname === "places.googleapis.com") {
      return parsed.pathname.endsWith("/media");
    }
    return false;
  } catch {
    return false;
  }
}

function resolveServerGoogleMapsApiKey(): string | null {
  const serverKey = process.env.GOOGLE_MAPS_API_KEY;
  if (serverKey) return serverKey;

  const publicKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (publicKey) {
    console.warn(
      "[places/photo] GOOGLE_MAPS_API_KEY is not set; falling back to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Use a server-only key for reliable photo proxying."
    );
    return publicKey;
  }

  return null;
}

function photoUrlWithServerKey(storedUrl: string, apiKey: string): string {
  const parsed = new URL(storedUrl);
  parsed.searchParams.set("key", apiKey);
  return parsed.toString();
}

function isGooglePhotoFailureStatus(status: number): boolean {
  return status === 403 || status === 429;
}

function photoUnavailableResponse(upstreamStatus: number): NextResponse {
  return NextResponse.json(
    { error: "Photo unavailable" },
    {
      status: upstreamStatus === 429 ? 429 : 404,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function GET(request: NextRequest) {
  const placeId = request.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  if (process.env.DISABLE_PLACE_PHOTO_PROXY === "true") {
    return NextResponse.json(
      { error: "Photo proxy disabled" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: place } = await supabase
    .from("places")
    .select("photo_url, trips!inner(user_id)")
    .eq("id", placeId)
    .single();

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const trip = place.trips as unknown as { user_id: string };
  if (trip.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const photoUrl = place.photo_url;
  if (!photoUrl || !isAllowedGooglePhotoUrl(photoUrl)) {
    return NextResponse.json({ error: "No photo available" }, { status: 404 });
  }

  const apiKey = resolveServerGoogleMapsApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server Google Maps API key missing" },
      { status: 500 }
    );
  }

  const upstream = await fetch(photoUrlWithServerKey(photoUrl, apiKey));
  if (!upstream.ok) {
    if (isGooglePhotoFailureStatus(upstream.status)) {
      return photoUnavailableResponse(upstream.status);
    }
    return NextResponse.json(
      { error: "Photo unavailable" },
      { status: upstream.status, headers: { "Cache-Control": "no-store" } }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
