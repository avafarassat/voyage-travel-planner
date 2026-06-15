"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  InfoWindow,
  Marker,
} from "@react-google-maps/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { MUTED_MAP_STYLES } from "@/lib/map/map-styles";
import { zoomFactor } from "@/lib/map/pin-icons";
import { buildGoogleMapsSearchUrl } from "@/lib/maps/google-maps-link";
import {
  DEFAULT_HOTEL_EXPLORE_FILTERS,
  exploreLocationLabel,
  filterHotelExploreResults,
  hasActiveHotelExploreFilters,
  type HotelExploreFilters,
  type HotelExploreResult,
} from "@/lib/maps/hotel-explore";
import { isHotelSearchUnavailableError } from "@/lib/maps/mock-hotel-explore";
import { cn } from "@/lib/utils";
import type { Hotel } from "@/lib/types";
import {
  Compass,
  ExternalLink,
  Loader2,
  MapPin,
  Search,
  Star,
} from "lucide-react";

export type { HotelExploreResult } from "@/lib/maps/hotel-explore";
export {
  defaultHotelExploreQuery,
  queryForHotelSearch,
} from "@/lib/maps/hotel-explore";

const MIN_RATING_OPTIONS = [
  { value: "0", label: "Any rating" },
  { value: "4", label: "4.0+" },
  { value: "4.5", label: "4.5+" },
  { value: "4.7", label: "4.7+" },
] as const;

const PRICE_LEVEL_OPTIONS = [
  { value: "any", label: "Any price" },
  { value: "0", label: "$" },
  { value: "1", label: "$$" },
  { value: "2", label: "$$$" },
  { value: "3", label: "$$$$" },
] as const;

interface HotelExplorePanelProps {
  tripId: string;
  hotel: Hotel | null;
  city: string;
  country?: string | null;
  defaultQuery: string;
  results: HotelExploreResult[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearch: () => void;
  onBack: () => void;
  onEnterManually?: () => void;
  onSaved: () => void;
  preserveCheckIn?: string;
  preserveCheckOut?: string;
  preserveNotes?: string;
}

const mapContainerStyle = { width: "100%", height: "100%" };

const EXPLORE_HOTEL_PIN_COLOR = "#7C3AED";
const EXPLORE_HOTEL_SELECTED_COLOR = "#4C1D95";
const EXPLORE_HOTEL_ICON =
  '<path d="M16 9.5 10.5 14v6h3v-3.5h5V20h3v-6L16 9.5z" fill="#FFFFFF"/>';

function buildExploreHotelPinSvg(color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40">` +
    `<path d="M16 0C9.925 0 5 4.925 5 11c0 8.25 11 29 11 29s11-20.75 11-29C27 4.925 22.075 0 16 0z" ` +
    `fill="${color}" stroke="#FFFFFF" stroke-width="1.25" stroke-linejoin="round"/>` +
    `${EXPLORE_HOTEL_ICON}</svg>`
  );
}

function createExploreHotelPinIcon(zoom: number, selected: boolean): google.maps.Icon {
  const factor = zoomFactor(zoom);
  const scale = selected ? 1.25 : 1;
  const w = Math.max(1, Math.round(32 * scale * factor));
  const h = Math.max(1, Math.round(40 * scale * factor));
  const color = selected ? EXPLORE_HOTEL_SELECTED_COLOR : EXPLORE_HOTEL_PIN_COLOR;
  return {
    url: `data:image/svg+xml,${encodeURIComponent(buildExploreHotelPinSvg(color))}`,
    scaledSize: { width: w, height: h } as google.maps.Size,
    anchor: { x: w / 2, y: h } as google.maps.Point,
  };
}

function exploreSelectedPinHeight(zoom: number): number {
  return Math.max(1, Math.round(40 * 1.25 * zoomFactor(zoom)));
}

function formatPriceLevel(level?: number): string | null {
  if (level == null || level < 0) return null;
  const clamped = Math.min(4, Math.max(0, Math.round(level)));
  return "$".repeat(clamped + 1);
}

function HotelExploreMap({
  results,
  selectedPlaceId,
  onSelectPlace,
  onSelectHotel,
  savingPlaceId,
  hasExistingHotel,
}: {
  results: HotelExploreResult[];
  selectedPlaceId: string | null;
  onSelectPlace: (placeId: string | null) => void;
  onSelectHotel: (result: HotelExploreResult) => void;
  savingPlaceId: string | null;
  hasExistingHotel: boolean;
}) {
  const [zoom, setZoom] = useState(13);
  const mapRef = useRef<google.maps.Map | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const missingKey = !apiKey || apiKey === "your-google-maps-api-key";

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: missingKey ? "" : apiKey,
  });

  const center = useMemo(() => {
    const selected = results.find((r) => r.placeId === selectedPlaceId);
    if (selected) return { lat: selected.lat, lng: selected.lng };
    if (results.length > 0) return { lat: results[0].lat, lng: results[0].lng };
    return { lat: 41.3874, lng: 2.1686 };
  }, [results, selectedPlaceId]);

  const hotelIcon = useMemo(
    () => (isLoaded ? createExploreHotelPinIcon(zoom, false) : undefined),
    [zoom, isLoaded]
  );

  const selectedHotelIcon = useMemo(
    () => (isLoaded ? createExploreHotelPinIcon(zoom, true) : undefined),
    [zoom, isLoaded]
  );

  const selectedPinHeight = useMemo(() => exploreSelectedPinHeight(zoom), [zoom]);

  const selectedAnchorDot = useMemo(() => {
    if (!isLoaded) return undefined;
    return {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: EXPLORE_HOTEL_SELECTED_COLOR,
      fillOpacity: 1,
      strokeColor: "#FFFFFF",
      strokeWeight: 2,
      scale: 7,
    } as google.maps.Symbol;
  }, [isLoaded]);

  const fitToResults = useCallback(
    (map: google.maps.Map) => {
      const valid = results.filter(
        (r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)
      );
      if (valid.length === 0) return;

      if (valid.length === 1) {
        map.setCenter({ lat: valid[0].lat, lng: valid[0].lng });
        map.setZoom(14);
        return;
      }

      const bounds = new google.maps.LatLngBounds();
      for (const result of valid) {
        bounds.extend({ lat: result.lat, lng: result.lng });
      }
      map.fitBounds(bounds, 48);
    },
    [results]
  );

  const onLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      fitToResults(map);
    },
    [fitToResults]
  );

  useEffect(() => {
    if (mapRef.current) {
      fitToResults(mapRef.current);
    }
  }, [fitToResults]);

  useEffect(() => {
    if (!selectedPlaceId || !mapRef.current) return;
    const selected = results.find((r) => r.placeId === selectedPlaceId);
    if (!selected) return;
    mapRef.current.panTo({ lat: selected.lat, lng: selected.lng });
  }, [selectedPlaceId, results]);

  const onZoomChanged = useCallback(() => {
    const z = mapRef.current?.getZoom();
    if (z != null && Number.isFinite(z)) setZoom(z);
  }, []);

  if (missingKey) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border bg-muted p-6 text-center text-sm text-muted-foreground">
        Google Maps API key needed to show hotel pins.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border bg-muted p-6 text-center text-sm text-muted-foreground">
        Map failed to load.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground">
        Loading map...
      </div>
    );
  }

  return (
    <div className="h-full min-h-[280px] overflow-hidden rounded-lg border">
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={13}
        onLoad={onLoad}
        onZoomChanged={onZoomChanged}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          styles: MUTED_MAP_STYLES,
        }}
      >
        {results.map((result) => {
          if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return null;
          const isSelected = selectedPlaceId === result.placeId;

          return (
            <Marker
              key={result.placeId}
              position={{ lat: result.lat, lng: result.lng }}
              icon={isSelected ? selectedHotelIcon : hotelIcon}
              opacity={isSelected ? 1 : selectedPlaceId ? 0.55 : 0.9}
              zIndex={isSelected ? 2001 : 1}
              onClick={() => onSelectPlace(result.placeId)}
            />
          );
        })}

        {selectedPlaceId && selectedAnchorDot && (() => {
          const selected = results.find((r) => r.placeId === selectedPlaceId);
          if (!selected) return null;
          return (
            <Marker
              key={`anchor-${selected.placeId}`}
              position={{ lat: selected.lat, lng: selected.lng }}
              icon={selectedAnchorDot}
              zIndex={1999}
              clickable={false}
            />
          );
        })()}

        {results.map((result) => {
          if (selectedPlaceId !== result.placeId) return null;
          const mapsUrl = buildGoogleMapsSearchUrl({
            placeId: result.placeId,
            name: result.name,
            address: result.address,
          });
          const isSaving = savingPlaceId === result.placeId;

          return (
            <InfoWindow
              key={`info-${result.placeId}`}
              position={{ lat: result.lat, lng: result.lng }}
              options={{
                pixelOffset: new google.maps.Size(0, -(selectedPinHeight + 14)),
              }}
              onCloseClick={() => onSelectPlace(null)}
            >
              <div className="max-w-[220px] p-1">
                <p className="font-semibold">{result.name}</p>
                {result.address && (
                  <p className="mt-1 text-xs text-gray-600">{result.address}</p>
                )}
                {result.rating != null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-700">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {result.rating.toFixed(1)}
                    {result.userRatingsTotal != null && (
                      <span className="text-gray-500">
                        ({result.userRatingsTotal.toLocaleString()})
                      </span>
                    )}
                  </p>
                )}
                <div className="mt-2 flex flex-col gap-1.5">
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
                    >
                      View on Google Maps
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={isSaving}
                    className="text-left text-xs font-medium text-violet-700 hover:underline disabled:opacity-50"
                    onClick={() => onSelectHotel(result)}
                  >
                    {isSaving
                      ? "Saving..."
                      : hasExistingHotel
                        ? "Select hotel"
                        : "Set as home base"}
                  </button>
                </div>
              </div>
            </InfoWindow>
          );
        })}
      </GoogleMap>
    </div>
  );
}

export function HotelExplorePanel({
  tripId,
  hotel,
  city,
  country,
  defaultQuery,
  results,
  loading,
  error,
  searchQuery,
  onSearchQueryChange,
  onSearch,
  onBack,
  onEnterManually,
  onSaved,
  preserveCheckIn = "",
  preserveCheckOut = "",
  preserveNotes = "",
}: HotelExplorePanelProps) {
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [savingPlaceId, setSavingPlaceId] = useState<string | null>(null);
  const [filters, setFilters] = useState<HotelExploreFilters>(DEFAULT_HOTEL_EXPLORE_FILTERS);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const filteredResults = useMemo(
    () => filterHotelExploreResults(results, filters),
    [results, filters]
  );

  const filtersActive = hasActiveHotelExploreFilters(filters);

  const resultsCountLabel = useMemo(() => {
    if (results.length === 0) return null;
    if (filtersActive) {
      return `${filteredResults.length} of ${results.length} hotels`;
    }
    return `${results.length} hotel${results.length === 1 ? "" : "s"}`;
  }, [results.length, filteredResults.length, filtersActive]);

  useEffect(() => {
    setSelectedPlaceId(null);
  }, [results]);

  useEffect(() => {
    if (!selectedPlaceId) return;
    if (!filteredResults.some((result) => result.placeId === selectedPlaceId)) {
      setSelectedPlaceId(null);
    }
  }, [filteredResults, selectedPlaceId]);

  useEffect(() => {
    if (!selectedPlaceId) return;
    rowRefs.current[selectedPlaceId]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selectedPlaceId]);

  async function handleSelectHotel(result: HotelExploreResult) {
    setSavingPlaceId(result.placeId);

    try {
      const supabase = createClient();
      const payload = {
        trip_id: tripId,
        name: result.name,
        address: result.address,
        lat: result.lat,
        lng: result.lng,
        check_in: preserveCheckIn || null,
        check_out: preserveCheckOut || null,
        notes: preserveNotes || null,
      };

      if (hotel) {
        const { error: updateError } = await supabase
          .from("hotels")
          .update(payload)
          .eq("id", hotel.id);
        if (updateError) throw updateError;
        toast({ title: "Hotel updated" });
      } else {
        const { error: insertError } = await supabase.from("hotels").insert(payload);
        if (insertError) throw insertError;
        toast({ title: "Hotel saved as home base" });
      }

      onSaved();
    } catch (err) {
      toast({
        title: "Could not save hotel",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSavingPlaceId(null);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSearch();
  }

  function clearFilters() {
    setFilters(DEFAULT_HOTEL_EXPLORE_FILTERS);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-violet-600" />
          Explore hotels
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Search lodging in {exploreLocationLabel(city, country)}. Pick a hotel to set your home base.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={defaultQuery}
            aria-label="Hotel search"
          />
          <Button type="submit" className="gap-2 sm:shrink-0" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Search
          </Button>
        </form>

        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Filters
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {resultsCountLabel && (
                <p className="text-xs text-muted-foreground">{resultsCountLabel}</p>
              )}
              {filtersActive && (
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hotel-filter-rating" className="text-xs">
                Minimum rating
              </Label>
              <Select
                value={String(filters.minRating)}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, minRating: Number(value) }))
                }
              >
                <SelectTrigger id="hotel-filter-rating" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MIN_RATING_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hotel-filter-price" className="text-xs">
                Price level
              </Label>
              <Select
                value={filters.priceLevel == null ? "any" : String(filters.priceLevel)}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    priceLevel: value === "any" ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger id="hotel-filter-price" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {error && (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              isHotelSearchUnavailableError(error)
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            )}
          >
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-2 lg:max-h-[min(70vh,640px)] lg:overflow-y-auto">
            {loading && results.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching hotels...
              </div>
            )}

            {!loading && results.length === 0 && !error && (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No hotels found. Try a different search.
              </div>
            )}

            {!loading && results.length > 0 && filteredResults.length === 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No hotels match these filters. Try lowering the rating or changing the price level.
              </div>
            )}

            {filteredResults.map((result) => {
              const isSelected = selectedPlaceId === result.placeId;
              const priceLabel = formatPriceLevel(result.priceLevel);
              const mapsUrl = buildGoogleMapsSearchUrl({
                placeId: result.placeId,
                name: result.name,
                address: result.address,
              });
              const isSaving = savingPlaceId === result.placeId;

              return (
                <div
                  key={result.placeId}
                  ref={(el) => {
                    rowRefs.current[result.placeId] = el;
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPlaceId(result.placeId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedPlaceId(result.placeId);
                    }
                  }}
                  className={cn(
                    "rounded-lg border p-3 transition-colors",
                    isSelected
                      ? "border-violet-400 bg-violet-50/80 ring-1 ring-violet-300"
                      : "bg-card hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium leading-snug">{result.name}</p>
                      {result.address && (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{result.address}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {result.rating != null && (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {result.rating.toFixed(1)}
                            {result.userRatingsTotal != null && (
                              <span>({result.userRatingsTotal.toLocaleString()})</span>
                            )}
                          </span>
                        )}
                        {priceLabel && <span>{priceLabel}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSaving}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleSelectHotel(result);
                      }}
                    >
                      {isSaving ? "Saving..." : hotel ? "Select hotel" : "Set as home base"}
                    </Button>
                    {mapsUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a href={mapsUrl} target="_blank" rel="noreferrer">
                          View on Google Maps
                          <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="h-[320px] lg:sticky lg:top-4 lg:h-[min(70vh,640px)]">
            <HotelExploreMap
              results={filteredResults}
              selectedPlaceId={selectedPlaceId}
              onSelectPlace={setSelectedPlaceId}
              onSelectHotel={handleSelectHotel}
              savingPlaceId={savingPlaceId}
              hasExistingHotel={!!hotel}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          {onEnterManually && (
            <Button type="button" variant="outline" onClick={onEnterManually}>
              Enter manually
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
