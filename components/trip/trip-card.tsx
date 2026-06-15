"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TripDatesDialog } from "@/components/trip/trip-dates-dialog";
import { TripDeleteDialog } from "@/components/trip/trip-delete-dialog";
import { cn, formatDate } from "@/lib/utils";
import type { Trip } from "@/lib/types";

const PLACE_PHOTO_PROXY_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY === "true";

interface TripCardProps {
  trip: Trip;
  isPast?: boolean;
}

export function TripCard({ trip, isPast }: TripCardProps) {
  const [coverFailed, setCoverFailed] = useState(false);

  const showCover =
    !PLACE_PHOTO_PROXY_DISABLED && trip.cover_image_url && !coverFailed;

  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow hover:shadow-md",
        isPast && "opacity-80 hover:opacity-90"
      )}
    >
      <Link href={`/trips/${trip.id}`} className="block">
        <div className="relative h-32 overflow-hidden bg-gradient-to-br from-indigo-400 to-purple-500">
          {showCover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trip.cover_image_url!}
              alt=""
              className={cn(
                "h-full w-full object-cover object-center",
                isPast && "grayscale"
              )}
              onError={() => setCoverFailed(true)}
            />
          )}
          {isPast && <div className="absolute inset-0 bg-black/25" />}
          {isPast && (
            <Badge
              variant="secondary"
              className="absolute right-2 top-2 bg-background/90 text-xs"
            >
              Past trip
            </Badge>
          )}
        </div>
      </Link>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/trips/${trip.id}`} className="min-w-0 flex-1">
            <h3 className={cn("font-semibold", isPast && "text-muted-foreground")}>
              {trip.name}
            </h3>
            <p className="text-sm text-muted-foreground">{trip.city}</p>
          </Link>
          <div className="flex shrink-0 items-center gap-0.5">
            {!isPast && <TripDatesDialog trip={trip} variant="icon" />}
            <TripDeleteDialog tripId={trip.id} tripName={trip.name} />
          </div>
        </div>
        <Link href={`/trips/${trip.id}`} className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
        </Link>
      </CardContent>
    </Card>
  );
}
