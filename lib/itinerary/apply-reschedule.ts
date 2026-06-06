import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceCategory } from "@/lib/types";
import type { OpeningHours } from "@/lib/itinerary/hours";
import {
  parseTimeToMinutes,
  rescheduleFollowingStops,
  rescheduleStopsFromOrder,
  rhythmSortOrderUpdates,
  type RescheduleStop,
} from "@/lib/itinerary/reschedule-day";

function normalizePlace<T extends { place?: unknown }>(row: T): T & {
  place: {
    lat: number;
    lng: number;
    category?: PlaceCategory;
    reservation_time?: string | null;
    reservation_date?: string | null;
    opening_hours?: OpeningHours | null;
  } | null;
} {
  const p = row.place;
  const place = Array.isArray(p) ? p[0] : p;
  return { ...row, place: place ?? null };
}

function toRescheduleStop(
  s: {
    id: string;
    sort_order: number;
    stop_type: string;
    meal_type: string | null;
    duration_minutes: number | null;
    scheduled_time: string | null;
    place: {
      lat: number;
      lng: number;
      category?: PlaceCategory;
      name?: string;
      reservation_time?: string | null;
      reservation_date?: string | null;
      opening_hours?: OpeningHours | null;
    } | null;
  },
  dayDate: string
): RescheduleStop {
  return {
    id: s.id,
    sort_order: s.sort_order,
    stop_type: s.stop_type,
    meal_type: s.meal_type,
    duration_minutes: s.duration_minutes,
    scheduled_time: s.scheduled_time,
    anchor_time:
      s.place?.reservation_time && s.place.reservation_date === dayDate
        ? s.place.reservation_time
        : null,
    place: s.place
      ? {
          lat: s.place.lat,
          lng: s.place.lng,
          category: s.place.category,
          name: s.place.name,
        }
      : null,
    opening_hours: s.place?.opening_hours ?? null,
  };
}

export async function rescheduleItineraryDay(
  supabase: SupabaseClient,
  dayId: string,
  dayDate: string
): Promise<void> {
  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, date, trip_id, trips!inner(day_start_time)")
    .eq("id", dayId)
    .single();

  if (!day) return;

  const trip = day.trips as unknown as { day_start_time: string | null };
  const { data: hotel } = await supabase
    .from("hotels")
    .select("lat, lng")
    .eq("trip_id", day.trip_id)
    .maybeSingle();

  if (!hotel) return;

  const dayStart = parseTimeToMinutes(trip.day_start_time ?? "08:00:00");

  const { data: stopsRaw } = await supabase
    .from("itinerary_stops")
    .select("*, place:places(lat, lng, category, name, reservation_time, reservation_date, opening_hours)")
    .eq("itinerary_day_id", dayId)
    .order("sort_order");

  const stops = (stopsRaw ?? []).map(normalizePlace).map((s) => toRescheduleStop(s, day.date ?? dayDate));

  const updates = rescheduleStopsFromOrder(
    stops,
    { lat: hotel.lat, lng: hotel.lng },
    dayStart,
    day.date ?? dayDate
  );

  const orderUpdates = rhythmSortOrderUpdates(stops);

  await Promise.all([
    ...updates.map((u) =>
      supabase
        .from("itinerary_stops")
        .update({ scheduled_time: u.scheduled_time })
        .eq("id", u.id)
    ),
    ...orderUpdates.map((u) =>
      supabase.from("itinerary_stops").update({ sort_order: u.sort_order }).eq("id", u.id)
    ),
  ]);
}

/** Re-apply reservation anchors and travel chaining for every day on a trip. */
export async function rescheduleAllItineraryDaysForTrip(
  supabase: SupabaseClient,
  tripId: string
): Promise<void> {
  const { data: days } = await supabase
    .from("itinerary_days")
    .select("id, date")
    .eq("trip_id", tripId)
    .order("day_number");

  for (const day of days ?? []) {
    await rescheduleItineraryDay(supabase, day.id, day.date);
  }
}

export async function rescheduleFollowingOnDay(
  supabase: SupabaseClient,
  dayId: string,
  fromStopId: string,
  departureMinutes: number,
  departureLocation: { lat: number; lng: number }
): Promise<void> {
  const { data: day } = await supabase
    .from("itinerary_days")
    .select("id, date, trip_id, trips!inner(day_start_time)")
    .eq("id", dayId)
    .single();

  if (!day) return;

  const { data: hotel } = await supabase
    .from("hotels")
    .select("lat, lng")
    .eq("trip_id", day.trip_id)
    .maybeSingle();

  if (!hotel) return;

  const { data: stopsRaw } = await supabase
    .from("itinerary_stops")
    .select("*, place:places(lat, lng, category, name, reservation_time, reservation_date, opening_hours)")
    .eq("itinerary_day_id", dayId)
    .order("sort_order");

  const stops = (stopsRaw ?? []).map(normalizePlace).map((s) => toRescheduleStop(s, day.date));

  const fromIndex = stops.findIndex((s) => s.id === fromStopId);
  if (fromIndex < 0) return;

  const updates = rescheduleFollowingStops(
    stops,
    fromIndex,
    { lat: hotel.lat, lng: hotel.lng },
    departureMinutes,
    departureLocation
  );

  await Promise.all(
    updates.map((u) =>
      supabase
        .from("itinerary_stops")
        .update({ scheduled_time: u.scheduled_time })
        .eq("id", u.id)
    )
  );
}
