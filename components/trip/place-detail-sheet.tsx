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
import { getCategoryStyle, type Place } from "@/lib/types";
import { ExternalLink, Loader2, Star } from "lucide-react";

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
  openingHours?: { weekday_text?: string[] };
  googleMapsUrl?: string;
}

interface PlaceDetailSheetProps {
  place: Place | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlaceDetailSheet({ place, open, onOpenChange }: PlaceDetailSheetProps) {
  const [detail, setDetail] = useState<PlaceDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);

  useEffect(() => {
    if (!open || !place) {
      setDetail(null);
      setPhotoIndex(0);
      return;
    }

    let cancelled = false;
    setLoading(true);

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
  const photos = detail?.photoUrls?.length ? detail.photoUrls : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-left">
            {detail?.name ?? place?.name ?? "Place details"}
          </DialogTitle>
        </DialogHeader>

        {loading && !detail ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {photos.length > 0 && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photos[photoIndex]}
                  alt=""
                  className="h-48 w-full rounded-lg object-cover"
                />
                {photos.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {photos.map((url, i) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setPhotoIndex(i)}
                        className={`shrink-0 overflow-hidden rounded-md border-2 ${
                          i === photoIndex ? "border-primary" : "border-transparent"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-12 w-12 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {catStyle && (
                <Badge variant="secondary">
                  {catStyle.emoji} {catStyle.label}
                </Badge>
              )}
              {detail?.rating != null && (
                <span className="inline-flex items-center gap-1 text-sm">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {detail.rating.toFixed(1)}
                  {detail.userRatingsTotal != null && (
                    <span className="text-muted-foreground">
                      ({detail.userRatingsTotal.toLocaleString()} reviews)
                    </span>
                  )}
                </span>
              )}
            </div>

            {detail?.address && (
              <p className="text-sm text-muted-foreground">{detail.address}</p>
            )}

            {detail?.openingHours?.weekday_text && detail.openingHours.weekday_text.length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium">Hours</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {detail.openingHours.weekday_text.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {detail?.reviews && detail.reviews.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Reviews</p>
                <div className="space-y-3">
                  {detail.reviews.map((review) => (
                    <div key={`${review.author}-${review.relativeTime}`} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{review.author}</span>
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {review.rating}
                          {review.relativeTime && ` · ${review.relativeTime}`}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-4 text-sm text-muted-foreground">{review.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail?.googleMapsUrl && (
              <Button variant="outline" className="w-full" asChild>
                <a href={detail.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open in Google Maps
                </a>
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
