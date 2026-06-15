"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCategoryStyle, type OpeningHours, type Place } from "@/lib/types";
import { ExternalLink, Loader2, Star } from "lucide-react";

const PLACE_PHOTO_PROXY_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY === "true";

interface PlaceDetailData {
  name: string;
  address: string;
  category?: Place["category"];
  rating?: number;
  userRatingsTotal?: number;
  photoUrls: string[];
  reviews: {
    author: string;
    rating: number;
    text: string;
    relativeTime?: string;
  }[];
  openingHours?: OpeningHours;
  googleMapsUrl?: string;
}

interface PlaceDetailSheetProps {
  place: Place | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isValidGoogleMapsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "maps.google.com" ||
      host === "www.google.com" ||
      host === "google.com" ||
      host.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}

function mapsSearchQuery(
  name: string,
  address: string | null | undefined
): string | null {
  const trimmedName = name.trim();
  const trimmedAddress = address?.trim();
  if (trimmedName && trimmedAddress) return `${trimmedName} ${trimmedAddress}`;
  if (trimmedName) return trimmedName;
  if (trimmedAddress) return trimmedAddress;
  return null;
}

function googleMapsLinkForPlace(
  detailUrl: string | undefined,
  place: Place | null,
  displayName: string,
  displayAddress: string | null | undefined
): string | null {
  if (detailUrl && isValidGoogleMapsUrl(detailUrl)) return detailUrl;

  const query = mapsSearchQuery(displayName, displayAddress);

  if (place?.google_place_id && query) {
    const params = new URLSearchParams({
      api: "1",
      query,
      query_place_id: place.google_place_id,
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  if (query) {
    const params = new URLSearchParams({ api: "1", query });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return null;
}

export function PlaceDetailSheet({ place, open, onOpenChange }: PlaceDetailSheetProps) {
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    if (!open || !place) {
      setDetail(null);
      setPhotoFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setPhotoFailed(false);

    fetch(`/api/places/details?placeId=${place.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setDetail(data as PlaceDetailData);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, place]);

  const catStyle = place ? getCategoryStyle(place.category) : null;

  const displayName = detail?.name ?? place?.name ?? "Place details";
  const displayAddress = detail?.address ?? place?.address;
  const displayRating = detail?.rating ?? place?.rating ?? undefined;
  const displayOpeningHours = detail?.openingHours ?? place?.opening_hours;
  const weekdayHours = displayOpeningHours?.weekday_text ?? [];
  const reviews = detail?.reviews ?? [];
  const mapsLink = googleMapsLinkForPlace(
    detail?.googleMapsUrl,
    place,
    place?.name ?? detail?.name ?? "",
    displayAddress
  );

  const canProxyPhoto =
    !PLACE_PHOTO_PROXY_DISABLED && place?.photo_url && place.id && !photoFailed;
  const showPhotoEmoji = !canProxyPhoto && catStyle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-left">{displayName}</DialogTitle>
        </DialogHeader>

        {canProxyPhoto && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/places/photo?placeId=${encodeURIComponent(place!.id)}`}
              alt=""
              className="h-48 w-full rounded-lg object-cover"
              onError={() => setPhotoFailed(true)}
            />
          </div>
        )}
        {showPhotoEmoji && (
          <div
            className="flex h-48 w-full items-center justify-center rounded-lg bg-muted text-5xl"
            style={{ color: catStyle!.color }}
          >
            {catStyle!.emoji}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {catStyle && (
            <Badge variant="secondary">
              {catStyle.emoji} {catStyle.label}
            </Badge>
          )}
          {loading && !detail && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading details…
            </span>
          )}
          {displayRating != null && (
            <span className="inline-flex items-center gap-1 text-sm">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {displayRating.toFixed(1)}
              {detail?.userRatingsTotal != null && (
                <span className="text-muted-foreground">
                  ({detail.userRatingsTotal.toLocaleString()} reviews)
                </span>
              )}
            </span>
          )}
        </div>

        {displayAddress && (
          <p className="text-sm text-muted-foreground">{displayAddress}</p>
        )}

        {weekdayHours.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Hours</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {weekdayHours.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {reviews.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Reviews</p>
            <div className="space-y-3">
              {reviews.map((review) => (
                <div
                  key={`${review.author}-${review.relativeTime}`}
                  className="rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{review.author}</span>
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {review.rating}
                      {review.relativeTime && ` · ${review.relativeTime}`}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">
                    {review.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {mapsLink && (
          <Button variant="outline" className="w-full" asChild>
            <a href={mapsLink} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              View on Google Maps
            </a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
