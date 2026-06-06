"use client";

import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";

interface PlaceReservationFieldsProps {
  hasReservation: boolean;
  onHasReservationChange: (value: boolean) => void;
  reservationDate: string;
  onReservationDateChange: (value: string) => void;
  reservationTime: string;
  onReservationTimeChange: (value: string) => void;
  tripStartDate: string;
  tripEndDate: string;
  idPrefix?: string;
}

export function PlaceReservationFields({
  hasReservation,
  onHasReservationChange,
  reservationDate,
  onReservationDateChange,
  reservationTime,
  onReservationTimeChange,
  tripStartDate,
  tripEndDate,
  idPrefix = "reservation",
}: PlaceReservationFieldsProps) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasReservation}
          onChange={(e) => onHasReservationChange(e.target.checked)}
          className="rounded border-input"
        />
        I have a reservation
      </label>
      {hasReservation && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-date`} className="text-xs">
              Date
            </Label>
            <DateInput
              id={`${idPrefix}-date`}
              min={tripStartDate}
              max={tripEndDate}
              value={reservationDate}
              onChange={onReservationDateChange}
              required={hasReservation}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-time`} className="text-xs">
              Time
            </Label>
            <Input
              id={`${idPrefix}-time`}
              type="time"
              value={reservationTime}
              onChange={(e) => onReservationTimeChange(e.target.value)}
              required={hasReservation}
            />
          </div>
        </div>
      )}
      {hasReservation && (
        <p className="text-xs text-muted-foreground">
          The itinerary will schedule this day around your booking.
        </p>
      )}
    </div>
  );
}
