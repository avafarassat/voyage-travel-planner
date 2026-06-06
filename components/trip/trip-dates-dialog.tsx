"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { Trip } from "@/lib/types";

interface TripDatesDialogProps {
  trip: Pick<Trip, "id" | "name" | "start_date" | "end_date">;
  /** Compact icon trigger for trip cards; default button for dashboard header. */
  variant?: "icon" | "button";
  className?: string;
  onUpdated?: () => void;
}

export function TripDatesDialog({
  trip,
  variant = "button",
  className,
  onUpdated,
}: TripDatesDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.start_date);
  const [endDate, setEndDate] = useState(trip.end_date);

  useEffect(() => {
    if (!open) return;
    setName(trip.name);
    setStartDate(trip.start_date);
    setEndDate(trip.end_date);
  }, [open, trip.name, trip.start_date, trip.end_date]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (startDate > endDate) {
      toast({
        title: "Invalid dates",
        description: "Start date must be on or before end date.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/trips/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: trip.id,
          name: name.trim(),
          startDate,
          endDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");

      const removedDays = data.itinerarySync?.removed ?? 0;
      const cleared = data.clearedReservations ?? 0;
      let description = "Trip dates updated.";
      if (removedDays > 0) {
        description += ` ${removedDays} day${removedDays === 1 ? "" : "s"} removed from your plan.`;
      }
      if (cleared > 0) {
        description += ` ${cleared} reservation${cleared === 1 ? "" : "s"} cleared (outside new dates).`;
      }

      toast({ title: "Trip updated", description });
      setOpen(false);
      onUpdated?.();
      router.refresh();
    } catch (err) {
      toast({
        title: "Could not update trip",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const trigger =
    variant === "icon" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7 shrink-0 text-muted-foreground", className)}
        aria-label="Edit trip dates"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    ) : (
      <Button type="button" variant="outline" size="sm" className={className}>
        <Pencil className="h-3.5 w-3.5" />
        Edit dates
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Edit trip</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`trip-name-${trip.id}`}>Trip name</Label>
            <Input
              id={`trip-name-${trip.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`trip-start-${trip.id}`}>Start date</Label>
              <Input
                id={`trip-start-${trip.id}`}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`trip-end-${trip.id}`}>End date</Label>
              <Input
                id={`trip-end-${trip.id}`}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Shortening the trip removes plan days at the end. Place reservations outside the new
            range are cleared — regenerate your itinerary if needed.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
