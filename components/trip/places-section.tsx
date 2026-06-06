"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaceAutocompleteInput } from "@/components/trip/place-autocomplete-input";
import { PlaceReservationFields } from "@/components/trip/place-reservation-fields";
import { toast } from "@/components/ui/use-toast";
import { formatDate, formatTime, placeHasReservation, cn } from "@/lib/utils";
import { PLACE_CATEGORIES, getCategoryStyle, type Place, type PlaceCategory } from "@/lib/types";

interface PlacesSectionProps {
  tripId: string;
  tripStartDate: string;
  tripEndDate: string;
  places: Place[];
  city: string;
  country?: string | null;
  onUpdate: () => void;
  onSelectPlace?: (placeId: string) => void;
  selectedPlaceId?: string | null;
  readOnly?: boolean;
  /** Narrow sidebar layout for My Map desktop panel */
  compact?: boolean;
}

function emptyForm() {
  return {
    name: "",
    address: "",
    category: "restaurant" as PlaceCategory,
    notes: "",
    hasReservation: false,
    reservationDate: "",
    reservationTime: "",
  };
}

function PlaceReservationEditor({
  place,
  tripStartDate,
  tripEndDate,
  onUpdate,
}: {
  place: Place;
  tripStartDate: string;
  tripEndDate: string;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasReservation, setHasReservation] = useState(placeHasReservation(place));
  const [reservationDate, setReservationDate] = useState(place.reservation_date ?? "");
  const [reservationTime, setReservationTime] = useState(
    place.reservation_time ? place.reservation_time.slice(0, 5) : ""
  );

  function resetFromPlace() {
    setHasReservation(placeHasReservation(place));
    setReservationDate(place.reservation_date ?? "");
    setReservationTime(place.reservation_time ? place.reservation_time.slice(0, 5) : "");
  }

  function handleCancel() {
    resetFromPlace();
    setEditing(false);
  }

  async function handleSave() {
    if (hasReservation && (!reservationDate || !reservationTime)) {
      toast({
        title: "Reservation needs date and time",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("places")
      .update({
        reservation_date: hasReservation ? reservationDate : null,
        reservation_time: hasReservation ? reservationTime : null,
      })
      .eq("id", place.id);

    setSaving(false);

    if (error) {
      const needsMigration = error.message.includes("reservation_date");
      toast({
        title: "Could not save reservation",
        description: needsMigration
          ? "Run the reservation migration in Supabase SQL Editor (see supabase/migrations/002_place_reservations.sql), then try again."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: hasReservation ? "Reservation saved" : "Reservation removed" });
    setEditing(false);
    onUpdate();
  }

  if (!editing) {
    return (
      <div className="border-t px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={() => {
            resetFromPlace();
            setEditing(true);
          }}
        >
          {placeHasReservation(place) ? "Edit reservation" : "Add reservation"}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t px-3 pb-3 pt-2" onClick={(e) => e.stopPropagation()}>
      <PlaceReservationFields
        idPrefix={`place-${place.id}`}
        hasReservation={hasReservation}
        onHasReservationChange={setHasReservation}
        reservationDate={reservationDate}
        onReservationDateChange={setReservationDate}
        reservationTime={reservationTime}
        onReservationTimeChange={setReservationTime}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
      />
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? "Saving..." : "Save reservation"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PlacesSection({
  tripId,
  tripStartDate,
  tripEndDate,
  places,
  city,
  country,
  onUpdate,
  onSelectPlace,
  selectedPlaceId,
  readOnly,
  compact = false,
}: PlacesSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    googlePlaceId?: string;
    photoUrl?: string;
  } | null>(null);
  const [form, setForm] = useState(emptyForm());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (form.hasReservation && (!form.reservationDate || !form.reservationTime)) {
      toast({
        title: "Reservation needs date and time",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    let lat: number;
    let lng: number;
    let formattedAddress: string;

    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
      formattedAddress = form.address;
    } else {
      const geoRes = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: form.address,
          name: form.name,
          city,
          country,
        }),
      });

      if (!geoRes.ok) {
        toast({ title: "Could not find location", description: "Try picking a suggestion from the dropdown.", variant: "destructive" });
        setLoading(false);
        return;
      }

      const geo = await geoRes.json();
      lat = geo.lat;
      lng = geo.lng;
      formattedAddress = geo.formattedAddress;
    }

    const supabase = createClient();

    const { error } = await supabase.from("places").insert({
      trip_id: tripId,
      name: form.name,
      address: formattedAddress,
      lat,
      lng,
      category: form.category,
      notes: form.notes || null,
      source: "manual",
      google_place_id: coords?.googlePlaceId ?? null,
      photo_url: coords?.photoUrl ?? null,
      reservation_date: form.hasReservation ? form.reservationDate : null,
      reservation_time: form.hasReservation ? form.reservationTime : null,
    });

    setLoading(false);

    if (error) {
      toast({ title: "Failed to add place", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Place added" });
    setForm(emptyForm());
    setCoords(null);
    setShowForm(false);
    onUpdate();
  }

  async function handleDelete(placeId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("places").delete().eq("id", placeId);
    if (error) {
      toast({ title: "Failed to remove", variant: "destructive" });
    } else {
      toast({ title: "Place removed" });
      onUpdate();
    }
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>
          Saved Places ({places.length})
        </h3>
        {!readOnly && (
          <Button
            size="sm"
            className={compact ? "h-8 shrink-0 text-xs" : undefined}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Cancel" : "Add place"}
          </Button>
        )}
      </div>

      {showForm && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a place</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <PlaceAutocompleteInput
                  value={form.name}
                  onValueChange={(name) => {
                    setCoords(null);
                    setForm({ ...form, name });
                  }}
                  onSelect={(selection) => {
                    setCoords({
                      lat: selection.lat,
                      lng: selection.lng,
                      googlePlaceId: selection.placeId,
                      photoUrl: selection.photoUrl,
                    });
                    setForm({
                      ...form,
                      name: selection.name,
                      address: selection.address,
                      category: selection.category ?? form.category,
                    });
                  }}
                  city={city}
                  country={country}
                  type="establishment"
                  placeholder="Start typing place name…"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={form.address}
                  onChange={(e) => {
                    setCoords(null);
                    setForm({ ...form, address: e.target.value });
                  }}
                  placeholder="Auto-filled when you pick a place"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v as PlaceCategory })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLACE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.emoji} {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <PlaceReservationFields
                hasReservation={form.hasReservation}
                onHasReservationChange={(hasReservation) =>
                  setForm({ ...form, hasReservation })
                }
                reservationDate={form.reservationDate}
                onReservationDateChange={(reservationDate) =>
                  setForm({ ...form, reservationDate })
                }
                reservationTime={form.reservationTime}
                onReservationTimeChange={(reservationTime) =>
                  setForm({ ...form, reservationTime })
                }
                tripStartDate={tripStartDate}
                tripEndDate={tripEndDate}
              />
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Adding..." : "Add to map"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">No places saved yet.</p>
        ) : (
          places.map((place) => {
            const style = getCategoryStyle(place.category);
            const isSelected = selectedPlaceId === place.id;
            const reserved = placeHasReservation(place);
            return (
              <div
                key={place.id}
                className={`overflow-hidden rounded-lg border transition-colors ${
                  isSelected ? "border-primary bg-accent/50" : ""
                }`}
              >
                <div
                  className={cn(
                    "flex cursor-pointer items-center justify-between hover:bg-muted/50",
                    compact ? "gap-2 p-2" : "p-3"
                  )}
                  onClick={() => onSelectPlace?.(place.id)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "flex shrink-0 items-center justify-center rounded-full",
                        compact ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm"
                      )}
                      style={{ backgroundColor: style.color + "22", color: style.color }}
                    >
                      {style.emoji}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className={cn("font-medium", compact && "truncate text-sm")}>
                          {place.name}
                        </p>
                        {reserved && place.reservation_date && (
                          <Badge variant="secondary" className="text-[10px]">
                            {compact ? "Reserved" : `Reserved · ${formatDate(place.reservation_date)}`}
                            {!compact && place.reservation_time && ` · ${formatTime(place.reservation_time)}`}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs capitalize text-muted-foreground">{place.category}</p>
                    </div>
                  </div>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("shrink-0 text-destructive", compact && "h-7 px-2 text-xs")}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(place.id);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {!readOnly && (
                  <PlaceReservationEditor
                    place={place}
                    tripStartDate={tripStartDate}
                    tripEndDate={tripEndDate}
                    onUpdate={onUpdate}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
