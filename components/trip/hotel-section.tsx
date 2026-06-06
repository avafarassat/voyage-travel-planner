"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaceAutocompleteInput } from "@/components/trip/place-autocomplete-input";
import { toast } from "@/components/ui/use-toast";
import type { Hotel } from "@/lib/types";

interface HotelSectionProps {
  tripId: string;
  hotel: Hotel | null;
  city: string;
  country?: string | null;
  onUpdate: () => void;
  readOnly?: boolean;
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
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hotel ? { lat: hotel.lat, lng: hotel.lng } : null
  );
  const [form, setForm] = useState({
    name: hotel?.name ?? "",
    address: hotel?.address ?? "",
    check_in: hotel?.check_in ?? "",
    check_out: hotel?.check_out ?? "",
    notes: hotel?.notes ?? "",
  });

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
          {hotel.check_in && <p>Check-in: {hotel.check_in}</p>}
          {hotel.check_out && <p>Check-out: {hotel.check_out}</p>}
          {hotel.notes && <p className="text-muted-foreground">{hotel.notes}</p>}
        </CardContent>
      </Card>
    );
  }

  if (readOnly) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hotel — Home Base</CardTitle>
      </CardHeader>
      <CardContent>
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
          <Button type="submit" disabled={loading}>
            {loading ? "Saving..." : hotel ? "Update hotel" : "Set as home base"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
