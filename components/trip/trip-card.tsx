"use client";

import Link from "next/link";
import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TripDatesDialog } from "@/components/trip/trip-dates-dialog";
import { cn, formatDate } from "@/lib/utils";
import type { Trip } from "@/lib/types";

interface TripCardProps {
  trip: Trip;
  isPast?: boolean;
}

export function TripCard({ trip, isPast }: TripCardProps) {
  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow hover:shadow-md",
        isPast && "opacity-80 hover:opacity-90"
      )}
    >
      <Link href={`/trips/${trip.id}`} className="block">
        <div className="relative h-32 overflow-hidden bg-gradient-to-br from-indigo-400 to-purple-500">
          {trip.cover_image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trip.cover_image_url}
              alt=""
              className={cn(
                "h-full w-full object-cover object-center",
                isPast && "grayscale"
              )}
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
          {!isPast && <TripDatesDialog trip={trip} variant="icon" />}
        </div>
        <Link href={`/trips/${trip.id}`} className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
        </Link>
      </CardContent>
    </Card>
  );
}
