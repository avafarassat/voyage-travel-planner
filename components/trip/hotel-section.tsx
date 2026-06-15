"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaceAutocompleteInput } from "@/components/trip/place-autocomplete-input";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/lib/utils";
import type { Hotel } from "@/lib/types";
import { ChevronRight, Compass, Hotel as HotelIcon, MapPin, Pencil } from "lucide-react";

interface HotelSectionProps {
  tripId: string;
  hotel: Hotel | null;
  city: string;
  country?: string | null;
  onUpdate: () => void;
  readOnly?: boolean;
}

function hotelFormState(hotel: Hotel | null) {
  return {
    name: hotel?.name ?? "",
    address: hotel?.address ?? "",
    check_in: hotel?.check_in ?? "",
    check_out: hotel?.check_out ?? "",
    notes: hotel?.notes ?? "",
  };
}

export function HotelSection({
  tripId,
  hotel,
  city,
  country,
  onUpdate,
  readOnly,
}: HotelSectionProps) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showExplorePlaceholder, setShowExplorePlaceholder] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hotel ? { lat: hotel.lat, lng: hotel.lng } : null
  );
  const [form, setForm] = useState(hotelFormState(hotel));

  useEffect(() => {
    setForm(hotelFormState(hotel));
    setCoords(hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
    setIsEditing(false);
    setShowManualForm(false);
    setShowExplorePlaceholder(false);
  }, [hotel]);

  async function resolveCoordinates() {
    if (coords) {
      return {
        lat: coords.lat,
        lng: coords.lng,
        formattedAddress: form.address,
      };
    }

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
      const data = await geoRes.json().catch(() => ({}));
      throw new Error(data.error ?? "Could not find address");
    }

    return geoRes.json();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { lat, lng, formattedAddress } = await resolveCoordinates();
      const supabase = createClient();

      const payload = {
        trip_id: tripId,
        name: form.name,
        address: formattedAddress || form.address,
        lat,
        lng,
        check_in: form.check_in || null,
        check_out: form.check_out || null,
        notes: form.notes || null,
      };

      if (hotel) {
        const { error } = await supabase.from("hotels").update(payload).eq("id", hotel.id);
        if (error) throw error;
        toast({ title: "Hotel updated" });
      } else {
        const { error } = await supabase.from("hotels").insert(payload);
        if (error) throw error;
        toast({ title: "Hotel saved as home base" });
      }

      setIsEditing(false);
      setShowManualForm(false);
      setShowExplorePlaceholder(false);
      onUpdate();
    } catch (err) {
      toast({
        title: "Could not save hotel",
        description: err instanceof Error ? err.message : "Try picking a suggestion from the dropdown.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleCancelEdit() {
    setForm(hotelFormState(hotel));
    setCoords(hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
    setIsEditing(false);
    setShowManualForm(false);
    setShowExplorePlaceholder(false);
  }

  if (readOnly && hotel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>🏠</span> {hotel.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{hotel.address}</p>
          {hotel.check_in && <p>Check-in: {formatDate(hotel.check_in)}</p>}
          {hotel.check_out && <p>Check-out: {formatDate(hotel.check_out)}</p>}
          {hotel.notes && <p className="text-muted-foreground">{hotel.notes}</p>}
        </CardContent>
      </Card>
    );
  }

  if (readOnly) return null;

  const showForm = (hotel && isEditing) || (!hotel && showManualForm);
  const displayHotel = hotel ?? null;

  const hotelForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="hotel-name">Hotel name</Label>
        <PlaceAutocompleteInput
          id="hotel-name"
          value={form.name}
          onValueChange={(name) => {
            setCoords(null);
            setForm({ ...form, name });
          }}
          onSelect={(selection) => {
            setCoords({ lat: selection.lat, lng: selection.lng });
            setForm({
              ...form,
              name: selection.name,
              address: selection.address,
            });
          }}
          city={city}
          country={country}
          type="lodging"
          placeholder="Start typing hotel name…"
          required
        />
        <p className="text-xs text-muted-foreground">
          Suggestions in {city}
          {country ? `, ${country}` : ""}. Pick one to auto-fill the address.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="hotel-address">Address</Label>
        <Input
          id="hotel-address"
          placeholder="Auto-filled when you pick a hotel"
          value={form.address}
          onChange={(e) => {
            setCoords(null);
            setForm({ ...form, address: e.target.value });
          }}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="check-in">Check-in</Label>
          <Input
            id="check-in"
            type="date"
            value={form.check_in}
            onChange={(e) => setForm({ ...form, check_in: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="check-out">Check-out</Label>
          <Input
            id="check-out"
            type="date"
            value={form.check_out}
            onChange={(e) => setForm({ ...form, check_out: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="hotel-notes">Notes</Label>
        <Textarea
          id="hotel-notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : displayHotel ? "Update hotel" : "Set as home base"}
        </Button>
        {(displayHotel || showManualForm) && (
          <Button type="button" variant="outline" disabled={loading} onClick={handleCancelEdit}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  if (showForm) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hotel — Home Base</CardTitle>
        </CardHeader>
        <CardContent>{hotelForm}</CardContent>
      </Card>
    );
  }

  if (displayHotel) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Home base
              </p>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HotelIcon className="h-5 w-5 shrink-0 text-violet-600" />
                <span className="truncate">{displayHotel.name}</span>
              </CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit hotel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{displayHotel.address}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Check-in</p>
              <p className="font-medium">
                {displayHotel.check_in ? formatDate(displayHotel.check_in) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Check-out</p>
              <p className="font-medium">
                {displayHotel.check_out ? formatDate(displayHotel.check_out) : "—"}
              </p>
            </div>
          </div>
          {displayHotel.notes && (
            <p className="text-sm text-muted-foreground">{displayHotel.notes}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  if (showExplorePlaceholder) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-violet-600" />
            Explore hotels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
            <Compass className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
            <p className="font-medium">Hotel exploration coming next</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Search and compare hotels on the map in {city}
              {country ? `, ${country}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setShowExplorePlaceholder(false)}>
              Back
            </Button>
            <Button type="button" variant="outline" onClick={() => {
              setShowExplorePlaceholder(false);
              setShowManualForm(true);
            }}>
              Enter manually
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hotel — Home Base</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
          <HotelIcon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/70" />
          <p className="font-medium">No hotel saved yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a home base in {city}
            {country ? `, ${country}` : ""} to anchor your trip on the map.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="gap-2 sm:flex-1"
            onClick={() => setShowExplorePlaceholder(true)}
          >
            Explore hotels
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1"
            onClick={() => setShowManualForm(true)}
          >
            Enter manually
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
