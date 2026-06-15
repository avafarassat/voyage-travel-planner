"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaceAutocompleteInput } from "@/components/trip/place-autocomplete-input";
import { HotelExplorePanel } from "@/components/trip/hotel-explore-panel";
import {
  defaultHotelExploreQuery,
  queryForHotelSearch,
  type HotelExploreResult,
} from "@/lib/maps/hotel-explore";
import {
  USE_MOCK_HOTEL_EXPLORE,
  friendlyHotelSearchError,
  getMockHotelExploreResults,
  MOCK_HOTEL_DESTINATION_EMPTY_MESSAGE,
} from "@/lib/maps/mock-hotel-explore";
import { toast } from "@/components/ui/use-toast";
import { formatDate } from "@/lib/utils";
import type { Hotel } from "@/lib/types";
import { ChevronRight, Compass, Hotel as HotelIcon, MapPin, Pencil } from "lucide-react";

interface HotelSectionProps {
  tripId: string;
  hotel: Hotel | null;
  city: string;
  country?: string | null;
  tripStartDate: string;
  tripEndDate: string;
  onUpdate: () => void;
  onExploreActiveChange?: (active: boolean) => void;
  readOnly?: boolean;
}

function hotelFormState(
  hotel: Hotel | null,
  tripStartDate: string,
  tripEndDate: string
) {
  return {
    name: hotel?.name ?? "",
    address: hotel?.address ?? "",
    check_in: hotel?.check_in ?? tripStartDate,
    check_out: hotel?.check_out ?? tripEndDate,
    notes: hotel?.notes ?? "",
  };
}

function withDefaultHotelDates<T extends { check_in: string; check_out: string }>(
  form: T,
  tripStartDate: string,
  tripEndDate: string
): T {
  return {
    ...form,
    check_in: form.check_in || tripStartDate,
    check_out: form.check_out || tripEndDate,
  };
}

export function HotelSection({
  tripId,
  hotel,
  city,
  country,
  tripStartDate,
  tripEndDate,
  onUpdate,
  onExploreActiveChange,
  readOnly,
}: HotelSectionProps) {
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showExplore, setShowExplore] = useState(false);
  const [exploreResults, setExploreResults] = useState<HotelExploreResult[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [exploreQuery, setExploreQuery] = useState(() => defaultHotelExploreQuery(city, country));
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    hotel ? { lat: hotel.lat, lng: hotel.lng } : null
  );
  const [form, setForm] = useState(() => hotelFormState(hotel, tripStartDate, tripEndDate));

  const defaultExploreQuery = defaultHotelExploreQuery(city, country);

  function handleCheckInChange(checkIn: string) {
    setForm((prev) => {
      const next = { ...prev, check_in: checkIn };
      if (checkIn && prev.check_out && prev.check_out < checkIn) {
        next.check_out = checkIn;
      }
      return next;
    });
  }

  useEffect(() => {
    setForm(hotelFormState(hotel, tripStartDate, tripEndDate));
    setCoords(hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
    setIsEditing(false);
    setShowManualForm(false);
    setShowExplore(false);
    setExploreResults([]);
    setExploreError(null);
    setExploreQuery(defaultHotelExploreQuery(city, country));
    onExploreActiveChange?.(false);
  }, [hotel, city, country, tripStartDate, tripEndDate, onExploreActiveChange]);

  async function runHotelSearch(displayQuery: string) {
    setExploreLoading(true);
    setExploreError(null);

    if (USE_MOCK_HOTEL_EXPLORE) {
      const mockResults = getMockHotelExploreResults(displayQuery, city, country);
      setExploreResults(mockResults);
      if (mockResults.length === 0) {
        setExploreError(MOCK_HOTEL_DESTINATION_EMPTY_MESSAGE);
      }
      setExploreLoading(false);
      return;
    }

    const apiQuery = queryForHotelSearch(displayQuery, city, country);

    try {
      const params = new URLSearchParams({
        query: apiQuery,
        type: "lodging",
        limit: "15",
      });
      if (city) params.set("city", city);
      if (country) params.set("country", country);

      const res = await fetch(`/api/places/autocomplete?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setExploreResults([]);
        setExploreError(friendlyHotelSearchError(data.error));
        return;
      }

      setExploreResults(data.results ?? []);
      if (!(data.results?.length ?? 0)) {
        setExploreError("No hotels found — try a different search.");
      }
    } catch {
      setExploreResults([]);
      setExploreError("Could not search. Check your connection.");
    } finally {
      setExploreLoading(false);
    }
  }

  function openManualEntryFromExplore() {
    closeExplore();
    setShowManualForm(true);
  }

  function openExplore() {
    const query = defaultHotelExploreQuery(city, country);
    setForm((prev) => withDefaultHotelDates(prev, tripStartDate, tripEndDate));
    setShowExplore(true);
    setShowManualForm(false);
    setIsEditing(false);
    setExploreQuery(query);
    setExploreResults([]);
    setExploreError(null);
    onExploreActiveChange?.(true);
    void runHotelSearch(query);
  }

  function closeExplore() {
    setShowExplore(false);
    setExploreResults([]);
    setExploreError(null);
    onExploreActiveChange?.(false);
  }

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
      closeExplore();
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
    setForm(hotelFormState(hotel, tripStartDate, tripEndDate));
    setCoords(hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
    setIsEditing(false);
    setShowManualForm(false);
    closeExplore();
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
            setForm((prev) =>
              withDefaultHotelDates(
                {
                  ...prev,
                  name: selection.name,
                  address: selection.address,
                },
                tripStartDate,
                tripEndDate
              )
            );
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
            min={tripStartDate}
            max={form.check_out || tripEndDate}
            onChange={(e) => handleCheckInChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="check-out">Check-out</Label>
          <Input
            id="check-out"
            type="date"
            value={form.check_out}
            min={form.check_in || tripStartDate}
            max={tripEndDate}
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

  if (showExplore) {
    return (
      <HotelExplorePanel
        tripId={tripId}
        hotel={hotel}
        city={city}
        country={country}
        defaultQuery={defaultExploreQuery}
        results={exploreResults}
        loading={exploreLoading}
        error={exploreError}
        searchQuery={exploreQuery}
        onSearchQueryChange={setExploreQuery}
        onSearch={() => void runHotelSearch(exploreQuery)}
        onBack={closeExplore}
        onEnterManually={openManualEntryFromExplore}
        onSaved={() => {
          closeExplore();
          onUpdate();
        }}
        preserveCheckIn={form.check_in}
        preserveCheckOut={form.check_out}
        preserveNotes={form.notes}
      />
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
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={openExplore}
              >
                <Compass className="h-3.5 w-3.5" />
                Explore hotels
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit hotel
              </Button>
            </div>
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
          <Button type="button" className="gap-2 sm:flex-1" onClick={openExplore}>
            Explore hotels
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1"
            onClick={() => {
              setForm((prev) => withDefaultHotelDates(prev, tripStartDate, tripEndDate));
              setShowManualForm(true);
            }}
          >
            Enter manually
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
