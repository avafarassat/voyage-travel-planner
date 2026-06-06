"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { formatDate, formatTime, placeHasReservation, pinnedStopScheduledTime, cn } from "@/lib/utils";
import { getSuggestionExcludeGoogleIds } from "@/lib/itinerary/suggestion-exclusions";
import {
  getCategoryStyle,
  PLACE_CATEGORIES,
  type Hotel,
  type ItineraryDay,
  type ItineraryStop,
  type Place,
  type PlaceCategory,
  type Trip,
  type TripInterest,
} from "@/lib/types";
import { ItineraryInterests, MIN_INTERESTS } from "@/components/trip/itinerary-interests";
import { PlaceDetailSheet } from "@/components/trip/place-detail-sheet";
import { MEAL_WINDOWS } from "@/lib/itinerary/hours";
import {
  GripVertical,
  Sparkles,
  Footprints,
  RefreshCw,
  BedDouble,
  Clock,
  Car,
  Train,
  Plus,
  Loader2,
  X,
} from "lucide-react";

interface ItinerarySectionProps {
  trip: Trip;
  hotel: Hotel | null;
  places: Place[];
  days: ItineraryDay[];
  stops: (ItineraryStop & { place?: Place })[];
  onUpdate: () => void;
  readOnly?: boolean;
  /** Desktop Plan tab: controls + map on top row, itinerary centered full width below. */
  wideLayout?: boolean;
  /** Renders the plan map; receives stops for the selected day only. */
  renderMap?: (places: Place[]) => ReactNode;
}

interface LegInfo {
  durationText: string;
  distanceText: string;
}

interface MultiDirectionInfo {
  walking: LegInfo | null;
  driving: LegInfo | null;
  transit: LegInfo | null;
}

interface LatLng {
  lat: number;
  lng: number;
}

function timeInputValue(time: string | null | undefined, fallback: string): string {
  if (!time) return fallback;
  return time.slice(0, 5);
}

function minutesToTimeInput(minutes: number): string {
  const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeInputToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function defaultRestStartTime(
  dayId: string,
  stops: ItineraryStop[],
  dayStart: string
): string {
  const dayStops = stops
    .filter((s) => s.itinerary_day_id === dayId)
    .sort((a, b) => a.sort_order - b.sort_order);
  if (dayStops.length === 0) return dayStart;
  const last = dayStops[dayStops.length - 1];
  const start = parseTimeInputToMinutes(timeInputValue(last.scheduled_time, dayStart));
  return minutesToTimeInput(start + (last.duration_minutes ?? 60));
}

function stopLocation(
  stop: ItineraryStop & { place?: Place },
  hotel: Hotel | null
): LatLng | null {
  if (stop.stop_type === "rest" && hotel) {
    return { lat: hotel.lat, lng: hotel.lng };
  }
  if (stop.place) return { lat: stop.place.lat, lng: stop.place.lng };
  return null;
}

function TravelLegs({ direction }: { direction?: MultiDirectionInfo }) {
  if (!direction) return null;
  const rows = [
    { icon: Footprints, label: "Walk", data: direction.walking },
    { icon: Car, label: "Drive", data: direction.driving },
    { icon: Train, label: "Transit", data: direction.transit },
  ].filter((r) => r.data);

  if (rows.length === 0) return null;

  return (
    <div className="ml-6 flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs text-muted-foreground sm:flex-nowrap">
      {rows.map(({ icon: Icon, label, data }) => (
        <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon className="h-3 w-3 shrink-0" />
          {label}: {data!.durationText} · {data!.distanceText}
        </span>
      ))}
    </div>
  );
}

function PlaceThumbnail({
  place,
  fallbackEmoji,
  color,
}: {
  place?: Place;
  fallbackEmoji?: string;
  color?: string;
}) {
  if (place?.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={place.photo_url}
        alt=""
        className="h-10 w-10 shrink-0 rounded-md object-cover"
      />
    );
  }
  if (fallbackEmoji) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-lg" style={{ color }}>
        {fallbackEmoji}
      </span>
    );
  }
  return null;
}

function isSuggestedStop(stop: ItineraryStop & { place?: Place }): boolean {
  if (stop.stop_type === "rest") return false;
  return stop.is_suggested || stop.place?.source === "suggested";
}

function SortableStop({
  stop,
  dayDate,
  direction,
  hotel,
  tripCity,
  allPlaces,
  allStops,
  onRefresh,
  onRemove,
  onEditTime,
  onPlaceClick,
  onToggleComplete,
  readOnly,
}: {
  stop: ItineraryStop & { place?: Place };
  dayDate: string;
  direction?: MultiDirectionInfo;
  hotel: Hotel | null;
  tripCity: string;
  allPlaces: Place[];
  allStops: (ItineraryStop & { place?: Place })[];
  onRefresh: () => void;
  onRemove: () => void;
  onEditTime?: () => void;
  onPlaceClick?: (place: Place) => void;
  onToggleComplete?: (completed: boolean) => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: stop.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isRest = stop.stop_type === "rest";
  const place = stop.place;
  const catStyle = place ? getCategoryStyle(place.category) : null;
  const suggested = isSuggestedStop(stop);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(stop.is_completed ?? false);
  const displayTime = pinnedStopScheduledTime(stop.scheduled_time, place, dayDate);
  const isPinnedReservation =
    !!place?.reservation_time && place.reservation_date === dayDate;

  useEffect(() => {
    setCompleted(stop.is_completed ?? false);
  }, [stop.is_completed]);

  async function handleToggleComplete(next: boolean) {
    setCompleting(true);
    setCompleted(next);
    try {
      const res = await fetch("/api/itinerary/complete-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopId: stop.id, isCompleted: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      onToggleComplete?.(next);
      toast({
        title: next ? "Marked done" : "Marked not done",
        description: next
          ? "This place will be skipped in future suggestions."
          : undefined,
      });
    } catch {
      setCompleted(!next);
      toast({ title: "Could not update status", variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      const res = await fetch("/api/itinerary/remove-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopId: stop.id }),
      });
      if (!res.ok) throw new Error("Remove failed");
      onRemove();
      toast({ title: "Removed from day" });
    } catch {
      toast({ title: "Could not remove stop", variant: "destructive" });
    } finally {
      setRemoving(false);
    }
  }

  async function handleRefresh() {
    if (!place || !hotel) return;
    setRefreshing(true);
    try {
      const excludeGoogleIds = getSuggestionExcludeGoogleIds(allPlaces, allStops);
      const res = await fetch("/api/itinerary/refresh-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopId: stop.id,
          lat: place.lat,
          lng: place.lng,
          city: tripCity,
          category: place.category,
          excludeGoogleIds,
        }),
      });
      if (!res.ok) throw new Error("Refresh failed");
      onRefresh();
      toast({ title: "Suggestion updated" });
    } catch {
      toast({ title: "Could not find an alternative", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div ref={setNodeRef} style={style}>
      <TravelLegs direction={direction} />
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-card p-3",
          completed && "opacity-70"
        )}
      >
        {!readOnly && (
          <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        {!readOnly && !isRest && (
          <input
            type="checkbox"
            checked={completed}
            disabled={completing}
            onChange={(e) => handleToggleComplete(e.target.checked)}
            className="h-4 w-4 shrink-0 rounded border border-input accent-primary"
            aria-label={completed ? "Mark as not done" : "Mark as done"}
            title={completed ? "Done — excluded from suggestions" : "Mark as done"}
          />
        )}

        {isRest ? (
          <BedDouble className="h-10 w-10 shrink-0 text-violet-600" />
        ) : (
          <button
            type="button"
            onClick={() => place && onPlaceClick?.(place)}
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!place}
          >
            <PlaceThumbnail
              place={place}
              fallbackEmoji={catStyle?.emoji}
              color={catStyle?.color}
            />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isRest || !place ? (
              <p className={cn("font-medium", completed && "line-through")}>
                {isRest ? stop.title ?? "Rest at hotel" : "Stop"}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => onPlaceClick?.(place)}
                className={cn(
                  "text-left font-medium hover:text-primary hover:underline",
                  completed && "line-through"
                )}
              >
                {place.name}
              </button>
            )}
            {completed && (
              <Badge variant="outline" className="text-[10px]">
                Done
              </Badge>
            )}
            {suggested && (
              <Badge variant="secondary" className="text-[10px]">
                Suggested
              </Badge>
            )}
            {stop.meal_type && (
              <Badge variant="outline" className="text-[10px] capitalize">
                {MEAL_WINDOWS[stop.meal_type].label}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isRest ? (
              <>
                Rest · {stop.duration_minutes ?? 60} min
                {displayTime && ` · ${formatTime(displayTime)}`}
              </>
            ) : (
              <>
                {place && <span className="capitalize">{place.category}</span>}
                <span className="ml-1">
                  · {stop.duration_minutes ?? 60} min
                  {displayTime && ` · ${formatTime(displayTime)}`}
                </span>
                {isPinnedReservation && (
                  <span className="ml-1 font-medium text-foreground">· Reserved</span>
                )}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {!readOnly && onEditTime && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={onEditTime}
              aria-label="Adjust time"
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          )}
          {!readOnly && suggested && place && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={refreshing}
              onClick={handleRefresh}
              aria-label="Regenerate suggestion"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground hover:text-destructive"
              disabled={removing}
              onClick={handleRemove}
              aria-label="Remove from day"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ItinerarySection({
  trip,
  hotel,
  places,
  days,
  stops,
  onUpdate,
  readOnly,
  wideLayout = false,
  renderMap,
}: ItinerarySectionProps) {
  const [generating, setGenerating] = useState(false);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [reschedulingDayId, setReschedulingDayId] = useState<string | null>(null);
  const [selectedMapDayId, setSelectedMapDayId] = useState<string | null>(null);
  const [interests, setInterests] = useState<TripInterest[]>(trip.interests ?? []);
  const [dayStartTime, setDayStartTime] = useState(
    timeInputValue(trip.day_start_time, "08:00")
  );
  const [dayEndTime, setDayEndTime] = useState(
    timeInputValue(trip.day_end_time, "22:00")
  );
  const [directions, setDirections] = useState<Record<string, MultiDirectionInfo>>({});
  const [restDayId, setRestDayId] = useState<string | null>(null);
  const [restDuration, setRestDuration] = useState("60");
  const [restStartTime, setRestStartTime] = useState("14:00");
  const [restForRemainder, setRestForRemainder] = useState(false);
  const [addingRest, setAddingRest] = useState(false);
  const [addStopDayId, setAddStopDayId] = useState<string | null>(null);
  const [addStopMode, setAddStopMode] = useState<"saved" | "suggest">("saved");
  const [addStopPlaceId, setAddStopPlaceId] = useState("");
  const [addStopCategory, setAddStopCategory] = useState<PlaceCategory>("bar");
  const [addStopAfterId, setAddStopAfterId] = useState<string>("end");
  const [addStopPreview, setAddStopPreview] = useState<{
    name: string;
    address: string;
    rating?: number;
    googlePlaceId: string;
  } | null>(null);
  const [excludeSuggestIds, setExcludeSuggestIds] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [addingStop, setAddingStop] = useState(false);
  const pendingGenerateRef = useRef(false);
  const photosBackfilledRef = useRef(false);
  const sparseFillRef = useRef(false);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [editStop, setEditStop] = useState<(ItineraryStop & { place?: Place }) | null>(
    null
  );
  const [editTime, setEditTime] = useState("09:00");
  const [editDuration, setEditDuration] = useState("60");
  const [editShiftFollowing, setEditShiftFollowing] = useState(true);
  const [savingTime, setSavingTime] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const stopsByDay = useMemo(
    () =>
      days.map((day) => ({
        day,
        stops: stops
          .filter((s) => s.itinerary_day_id === day.id)
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
    [days, stops]
  );

  useEffect(() => {
    if (!wideLayout || days.length === 0) return;
    setSelectedMapDayId((current) => {
      if (current && days.some((d) => d.id === current)) return current;
      return days[0].id;
    });
  }, [wideLayout, days]);

  const selectedMapDay = useMemo(
    () => days.find((d) => d.id === selectedMapDayId) ?? null,
    [days, selectedMapDayId]
  );

  const mapPlaces = useMemo(() => {
    if (!selectedMapDayId) return [];
    const dayStops = stopsByDay.find(({ day }) => day.id === selectedMapDayId)?.stops ?? [];
    const byId = new Map<string, Place>();
    for (const stop of dayStops) {
      if (stop.place?.lat != null && stop.place?.lng != null) {
        byId.set(stop.place.id, stop.place);
      }
    }
    return [...byId.values()];
  }, [selectedMapDayId, stopsByDay]);

  const directionLegsKey = useMemo(() => {
    if (!hotel) return "";
    const keys: string[] = [];
    for (const day of days) {
      const dayStops = stops
        .filter((s) => s.itinerary_day_id === day.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      for (let i = 0; i < dayStops.length - 1; i++) {
        const from = stopLocation(dayStops[i], hotel);
        const to = stopLocation(dayStops[i + 1], hotel);
        if (from && to) keys.push(`${dayStops[i].id}-${dayStops[i + 1].id}`);
      }
    }
    return keys.join("|");
  }, [days, stops, hotel]);

  const hasItinerary = stopsByDay.some(({ stops: s }) => s.length > 0);
  const showLoadingOverlay = generating;
  const showItinerary = hasItinerary && !generating;

  useEffect(() => {
    if (readOnly || photosBackfilledRef.current) return;
    const missingPhotos = places.some((p) => !p.photo_url);
    if (!missingPhotos) return;

    photosBackfilledRef.current = true;
    fetch("/api/places/backfill-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: trip.id }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.updated > 0) onUpdate();
      })
      .catch(() => {
        photosBackfilledRef.current = false;
      });
  }, [places, trip.id, readOnly, onUpdate]);

  useEffect(() => {
    if (readOnly || sparseFillRef.current || !hasItinerary) return;

    sparseFillRef.current = true;
    fetch("/api/itinerary/fill-sparse-days", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: trip.id }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.filledDays > 0 || data?.rescheduled) onUpdate();
      })
      .catch(() => {
        sparseFillRef.current = false;
      });
  }, [hasItinerary, readOnly, trip.id, onUpdate]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!hotel || !directionLegsKey) {
        if (!cancelled) {
          setDirections({});
          setDirectionsLoading(false);
        }
        return;
      }

      const pairs: { key: string; from: LatLng; to: LatLng }[] = [];
      for (const { stops: dayStops } of stopsByDay) {
        for (let i = 0; i < dayStops.length - 1; i++) {
          const from = stopLocation(dayStops[i], hotel);
          const to = stopLocation(dayStops[i + 1], hotel);
          if (!from || !to) continue;
          pairs.push({
            key: `${dayStops[i].id}-${dayStops[i + 1].id}`,
            from,
            to,
          });
        }
      }

      if (pairs.length === 0) {
        if (!cancelled) setDirectionsLoading(false);
        return;
      }

      setDirectionsLoading(true);

      try {
        const res = await fetch("/api/directions/multi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            legs: pairs.map(({ key, from, to }) => ({
              key,
              origin: from,
              destination: to,
            })),
          }),
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          setDirections((data.directions as Record<string, MultiDirectionInfo>) ?? {});
        }
      } catch {
        // Keep existing travel times on transient failures
      } finally {
        if (!cancelled) setDirectionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directionLegsKey, hotel, stopsByDay]);

  useEffect(() => {
    if (pendingGenerateRef.current && !generating) {
      pendingGenerateRef.current = false;
      toast({ title: "Itinerary ready!" });
    }
  }, [generating]);

  async function handleGenerate() {
    if (!hotel) {
      toast({ title: "Add your hotel first", variant: "destructive" });
      return;
    }
    if (interests.length < MIN_INTERESTS) {
      toast({
        title: `Pick at least ${MIN_INTERESTS} interests`,
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);
    pendingGenerateRef.current = true;

    try {
      const res = await fetch("/api/itinerary/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: trip.id,
          interests,
          dayStartTime: `${dayStartTime}:00`,
          dayEndTime: `${dayEndTime}:00`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Generation failed");
      }

      onUpdate();
      setGenerating(false);
    } catch (err) {
      pendingGenerateRef.current = false;
      toast({
        title: err instanceof Error ? err.message : "Generation failed",
        variant: "destructive",
      });
      setGenerating(false);
    }
  }

  async function handleAddRest() {
    if (!restDayId) return;
    setAddingRest(true);
    try {
      const res = await fetch("/api/itinerary/add-rest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayId: restDayId,
          startTime: restStartTime,
          durationMinutes: restForRemainder ? undefined : parseInt(restDuration, 10),
          restForRemainder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");

      if (data.fillSparseDays) {
        await fetch("/api/itinerary/fill-sparse-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tripId: trip.id }),
        });
      }

      toast({
        title: restForRemainder
          ? "Rest day set — other days topped up"
          : "Rest block added",
      });
      setRestDayId(null);
      setRestForRemainder(false);
      setRestStartTime("14:00");
      onUpdate();
    } catch {
      toast({ title: "Could not add rest block", variant: "destructive" });
    } finally {
      setAddingRest(false);
    }
  }

  const fetchStopPreview = useCallback(
    async (extraExclude: string[] = []) => {
      if (!addStopDayId || addStopMode !== "suggest") return;
      setLoadingPreview(true);
      try {
        const res = await fetch("/api/itinerary/suggest-stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dayId: addStopDayId,
            category: addStopCategory,
            insertAfterStopId: addStopAfterId === "end" ? null : addStopAfterId,
            excludeGoogleIds: [...excludeSuggestIds, ...extraExclude],
          }),
        });
        if (!res.ok) {
          setAddStopPreview(null);
          return;
        }
        const data = await res.json();
        setAddStopPreview({
          name: data.name,
          address: data.address,
          rating: data.rating,
          googlePlaceId: data.googlePlaceId,
        });
      } catch {
        setAddStopPreview(null);
      } finally {
        setLoadingPreview(false);
      }
    },
    [addStopDayId, addStopMode, addStopCategory, addStopAfterId, excludeSuggestIds]
  );

  useEffect(() => {
    if (addStopDayId && addStopMode === "suggest") {
      setExcludeSuggestIds([]);
      fetchStopPreview([]);
    }
  }, [addStopDayId, addStopMode, addStopCategory, addStopAfterId]);

  function resetAddStopDialog() {
    setAddStopDayId(null);
    setAddStopMode("saved");
    setAddStopPlaceId("");
    setAddStopCategory("bar");
    setAddStopAfterId("end");
    setAddStopPreview(null);
    setExcludeSuggestIds([]);
  }

  async function handleAddStop() {
    if (!addStopDayId) return;
    if (addStopMode === "saved" && !addStopPlaceId) return;
    setAddingStop(true);
    try {
      const res = await fetch("/api/itinerary/add-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayId: addStopDayId,
          placeId: addStopMode === "saved" ? addStopPlaceId : undefined,
          category: addStopMode === "suggest" ? addStopCategory : undefined,
          googlePlaceId:
            addStopMode === "suggest" ? addStopPreview?.googlePlaceId : undefined,
          insertAfterStopId: addStopAfterId === "end" ? null : addStopAfterId,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      const data = await res.json();
      toast({
        title: data.isSuggested
          ? `Added ${data.placeName ?? "suggestion"}`
          : "Stop added — schedule updated",
      });
      resetAddStopDialog();
      onUpdate();
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Could not add stop",
        variant: "destructive",
      });
    } finally {
      setAddingStop(false);
    }
  }

  async function handleDragEnd(dayId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const dayStops = stops
      .filter((s) => s.itinerary_day_id === dayId)
      .sort((a, b) => a.sort_order - b.sort_order);

    const oldIndex = dayStops.findIndex((s) => s.id === active.id);
    const newIndex = dayStops.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(dayStops, oldIndex, newIndex);

    const supabase = createClient();
    await Promise.all(
      reordered.map((s, i) =>
        supabase.from("itinerary_stops").update({ sort_order: i }).eq("id", s.id)
      )
    );

    setReschedulingDayId(dayId);
    try {
      await fetch("/api/itinerary/reschedule-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayId }),
      });
      onUpdate();
    } catch {
      toast({ title: "Could not update times", variant: "destructive" });
    } finally {
      setReschedulingDayId(null);
    }
  }

  function openEditTime(stop: ItineraryStop & { place?: Place }) {
    setEditStop(stop);
    setEditTime(timeInputValue(stop.scheduled_time, "09:00"));
    setEditDuration(String(stop.duration_minutes ?? 60));
    setEditShiftFollowing(true);
  }

  async function handleSaveTime() {
    if (!editStop) return;
    setSavingTime(true);
    try {
      const res = await fetch("/api/itinerary/update-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopId: editStop.id,
          scheduledTime: editTime,
          durationMinutes: parseInt(editDuration, 10),
          shiftFollowing: editShiftFollowing,
        }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Schedule updated" });
      setEditStop(null);
      onUpdate();
    } catch {
      toast({ title: "Could not update time", variant: "destructive" });
    } finally {
      setSavingTime(false);
    }
  }

  const addStopDay = stopsByDay.find(({ day }) => day.id === addStopDayId);
  const placesNotOnDay =
    addStopDay
      ? places.filter(
          (p) => !addStopDay.stops.some((s) => s.place_id === p.id)
        )
      : [];

  return (
    <div
      className={cn(
        "relative",
        wideLayout
          ? "space-y-4 lg:grid lg:grid-cols-2 lg:grid-rows-[minmax(280px,42vh)_auto] lg:gap-0 lg:space-y-0"
          : "space-y-4"
      )}
    >
      <div
        className={cn(
          wideLayout && "space-y-4 lg:overflow-y-auto lg:border-r lg:p-4 lg:pr-6"
        )}
      >
      {!readOnly && (
        <>
          <ItineraryInterests selected={interests} onChange={setInterests} />

          <div className="rounded-xl border bg-card p-4">
            <p className="mb-3 text-sm font-medium">Daily schedule bounds</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="day-start">Ideal start</Label>
                <Input
                  id="day-start"
                  type="time"
                  value={dayStartTime}
                  onChange={(e) => setDayStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="day-end">Ideal end</Label>
                <Input
                  id="day-end"
                  type="time"
                  value={dayEndTime}
                  onChange={(e) => setDayEndTime(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating || interests.length < MIN_INTERESTS}
          >
            <Sparkles className="h-4 w-4" />
            {generating ? "Building your plan..." : "Generate itinerary"}
          </Button>
          <p className="text-sm text-muted-foreground">
            Times account for stay duration plus travel between stops. Use the clock icon
            on any stop to adjust when plans change. Travel times below show walk, drive,
            and transit options.
          </p>
        </>
      )}
      </div>

      {wideLayout && renderMap && (
        <div className="relative hidden min-h-[280px] lg:block lg:h-[42vh]">
          {selectedMapDay && (
            <div className="absolute left-2 top-2 z-10 rounded-md border bg-background/95 px-2 py-1 text-xs font-medium shadow-sm">
              Day {selectedMapDay.day_number} · {formatDate(selectedMapDay.date)}
            </div>
          )}
          <div className="h-full [&>*]:h-full">{renderMap(mapPlaces)}</div>
        </div>
      )}

      <div className={cn(wideLayout && "lg:col-span-2 lg:border-t lg:px-4 lg:pt-6")}>
        <div className={cn("space-y-4", wideLayout && "mx-auto w-full max-w-4xl")}>

      {showLoadingOverlay && (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border bg-muted/30 p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm font-medium">Building your perfect day…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hang tight — your plan will appear when everything is ready.
          </p>
        </div>
      )}

      {showItinerary &&
        stopsByDay.map(({ day, stops: dayStops }) => (
          <Card
            key={day.id}
            className={cn(
              wideLayout &&
                selectedMapDayId === day.id &&
                "ring-2 ring-primary ring-offset-2 ring-offset-background"
            )}
          >
            <CardHeader
              className={cn(
                "flex flex-row flex-wrap items-center justify-between gap-2 pb-2",
                wideLayout && "cursor-pointer select-none"
              )}
              onClick={() => wideLayout && setSelectedMapDayId(day.id)}
            >
              <CardTitle className="text-base flex items-center gap-2">
                Day {day.day_number} — {formatDate(day.date)}
                {reschedulingDayId === day.id && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </CardTitle>
              {!readOnly && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddStopDayId(day.id);
                      setAddStopMode("saved");
                      setAddStopAfterId("end");
                      setAddStopPlaceId("");
                      setAddStopCategory("bar");
                      setAddStopPreview(null);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add stop
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRestDayId(day.id);
                      setRestStartTime(
                        defaultRestStartTime(day.id, stops, dayStartTime)
                      );
                      setRestForRemainder(false);
                    }}
                  >
                    <BedDouble className="h-3.5 w-3.5" />
                    Add rest
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {dayStops.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Generate your itinerary to fill this day.
                </p>
              ) : readOnly ? (
                <div className="space-y-1">
                  {dayStops.map((stop, idx) => {
                    const prev = dayStops[idx - 1];
                    const dirKey = prev ? `${prev.id}-${stop.id}` : null;
                    return (
                      <SortableStop
                        key={stop.id}
                        stop={stop}
                        dayDate={day.date}
                        direction={dirKey ? directions[dirKey] : undefined}
                        hotel={hotel}
                        tripCity={trip.city}
                        allPlaces={places}
                        allStops={stops}
                        onRefresh={onUpdate}
                        onRemove={onUpdate}
                        onPlaceClick={setDetailPlace}
                        readOnly
                      />
                    );
                  })}
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleDragEnd(day.id, e)}
                >
                  <SortableContext
                    items={dayStops.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1">
                      {dayStops.map((stop, idx) => {
                        const prev = dayStops[idx - 1];
                        const dirKey = prev ? `${prev.id}-${stop.id}` : null;
                        return (
                          <SortableStop
                            key={stop.id}
                            stop={stop}
                            dayDate={day.date}
                            direction={dirKey ? directions[dirKey] : undefined}
                            hotel={hotel}
                            tripCity={trip.city}
                            allPlaces={places}
                            allStops={stops}
                            onRefresh={onUpdate}
                            onRemove={onUpdate}
                            onEditTime={() => openEditTime(stop)}
                            onPlaceClick={setDetailPlace}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </CardContent>
          </Card>
        ))}

        </div>
      </div>

      <Dialog open={!!editStop} onOpenChange={(open) => !open && setEditStop(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust schedule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {editStop?.place?.name ?? editStop?.title ?? "Stop"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-stop-time">Arrival time</Label>
              <Input
                id="edit-stop-time"
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-stop-duration">Stay (minutes)</Label>
              <Input
                id="edit-stop-duration"
                type="number"
                min={15}
                max={480}
                step={15}
                value={editDuration}
                onChange={(e) => setEditDuration(e.target.value)}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={editShiftFollowing}
              onChange={(e) => setEditShiftFollowing(e.target.checked)}
              className="mt-1"
            />
            <span>
              Shift later stops to keep travel time realistic after this change
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditStop(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTime} disabled={savingTime}>
              {savingTime ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!restDayId}
        onOpenChange={(open) => {
          if (!open) {
            setRestDayId(null);
            setRestForRemainder(false);
            setRestStartTime("14:00");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add rest to your schedule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Head back to your room to recharge. Later stops on this day are removed when
            you rest for the remainder — other days can pick up fresh suggestions.
          </p>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="rest-mode"
                checked={!restForRemainder}
                onChange={() => setRestForRemainder(false)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Fixed rest block</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Later stops shift forward to keep your day realistic.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="rest-mode"
                checked={restForRemainder}
                onChange={() => setRestForRemainder(true)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Rest for the rest of the day</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Clears remaining stops on this day and fills sparse days elsewhere.
                </span>
              </span>
            </label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rest-start-time">Start time</Label>
            <Input
              id="rest-start-time"
              type="time"
              value={restStartTime}
              onChange={(e) => setRestStartTime(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {restForRemainder
                ? `Blocks from ${restStartTime} through the end of your day (${dayEndTime}). Stops scheduled at or after this time are removed.`
                : `Blocks ${restStartTime}–${minutesToTimeInput(
                    parseTimeInputToMinutes(restStartTime) + parseInt(restDuration, 10)
                  )}. Overlapping stops are removed; later stops shift after your rest.`}
            </p>
          </div>
          {!restForRemainder && (
            <div className="space-y-2">
              <Label htmlFor="rest-duration">Duration</Label>
              <Select value={restDuration} onValueChange={setRestDuration}>
                <SelectTrigger id="rest-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="90">1.5 hours</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
                  <SelectItem value="180">3 hours</SelectItem>
                  <SelectItem value="240">4 hours</SelectItem>
                  <SelectItem value="360">6 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setRestDayId(null);
                setRestForRemainder(false);
                setRestStartTime("14:00");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddRest} disabled={addingRest}>
              <Clock className="h-4 w-4" />
              {addingRest
                ? "Adding..."
                : restForRemainder
                  ? "Rest for the day"
                  : "Add rest block"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!addStopDayId}
        onOpenChange={(open) => !open && resetAddStopDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a stop to your day</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pick a saved place or get a top-rated suggestion by category. Times for the rest of
            the day update automatically.
          </p>

          <div className="flex gap-2">
            <Button
              type="button"
              variant={addStopMode === "saved" ? "default" : "outline"}
              size="sm"
              onClick={() => setAddStopMode("saved")}
            >
              Saved place
            </Button>
            <Button
              type="button"
              variant={addStopMode === "suggest" ? "default" : "outline"}
              size="sm"
              onClick={() => setAddStopMode("suggest")}
            >
              Get a suggestion
            </Button>
          </div>

          <div className="space-y-3">
            {addStopMode === "saved" ? (
              <div className="space-y-1">
                <Label>Place</Label>
                <Select value={addStopPlaceId} onValueChange={setAddStopPlaceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a place…" />
                  </SelectTrigger>
                  <SelectContent>
                    {placesNotOnDay.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {getCategoryStyle(p.category).emoji} {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {placesNotOnDay.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No saved places available — try &quot;Get a suggestion&quot; instead.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select
                    value={addStopCategory}
                    onValueChange={(v) => setAddStopCategory(v as PlaceCategory)}
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
                {loadingPreview && (
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Finding a top-rated spot nearby…
                  </div>
                )}
                {!loadingPreview && addStopPreview && (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-start gap-2">
                      <span>{getCategoryStyle(addStopCategory).emoji}</span>
                      <div>
                        <p className="font-medium">{addStopPreview.name}</p>
                        <p className="text-xs text-muted-foreground">{addStopPreview.address}</p>
                        {addStopPreview.rating != null && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            ★ {addStopPreview.rating.toFixed(1)}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="ml-auto text-[10px]">
                        Suggested
                      </Badge>
                    </div>
                  </div>
                )}
                {!loadingPreview && !addStopPreview && (
                  <p className="text-xs text-muted-foreground">
                    No match found nearby — try a different category or insert point.
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  disabled={loadingPreview || !addStopPreview}
                  onClick={() => {
                    if (addStopPreview) {
                      const nextExclude = [...excludeSuggestIds, addStopPreview.googlePlaceId];
                      setExcludeSuggestIds(nextExclude);
                      fetchStopPreview([addStopPreview.googlePlaceId]);
                    }
                  }}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? "animate-spin" : ""}`} />
                  Show another option
                </Button>
              </div>
            )}

            <div className="space-y-1">
              <Label>Insert after</Label>
              <Select value={addStopAfterId} onValueChange={setAddStopAfterId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {addStopDay?.stops.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.place?.name ?? s.title ?? "Stop"} (
                      {s.scheduled_time ? formatTime(s.scheduled_time) : "—"})
                    </SelectItem>
                  ))}
                  <SelectItem value="end">End of day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={resetAddStopDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleAddStop}
              disabled={
                addingStop ||
                (addStopMode === "saved" && !addStopPlaceId) ||
                (addStopMode === "suggest" && !addStopPreview)
              }
            >
              <Plus className="h-4 w-4" />
              {addingStop ? "Adding..." : "Add to itinerary"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PlaceDetailSheet
        place={detailPlace}
        open={detailPlace != null}
        onOpenChange={(open) => {
          if (!open) setDetailPlace(null);
        }}
      />
    </div>
  );
}
