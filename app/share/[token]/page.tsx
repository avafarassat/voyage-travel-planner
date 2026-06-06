import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TripDashboard } from "@/components/trip/trip-dashboard";
import type {
  Trip,
  Hotel,
  Place,
  Flight,
  TransportBooking,
  ItineraryDay,
  ItineraryStop,
} from "@/lib/types";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("share_token", token)
    .eq("is_public", true)
    .single();

  if (!trip) notFound();

  const tripId = trip.id;

  const [
    { data: hotel },
    { data: places },
    { data: flights },
    { data: transport },
    { data: itineraryDays },
    { data: itineraryStops },
  ] = await Promise.all([
    supabase.from("hotels").select("*").eq("trip_id", tripId).maybeSingle(),
    supabase.from("places").select("*").eq("trip_id", tripId).order("created_at"),
    supabase.from("flights").select("*").eq("trip_id", tripId).order("departure_time"),
    supabase.from("transport_bookings").select("*").eq("trip_id", tripId).order("pickup_time"),
    supabase.from("itinerary_days").select("*").eq("trip_id", tripId).order("day_number"),
    supabase
      .from("itinerary_stops")
      .select("*, place:places(*)")
      .in(
        "itinerary_day_id",
        (
          await supabase.from("itinerary_days").select("id").eq("trip_id", tripId)
        ).data?.map((d) => d.id) ?? []
      )
      .order("sort_order"),
  ]);

  const stopsWithPlaces = (itineraryStops ?? []).map((stop) => ({
    ...stop,
    place: Array.isArray(stop.place) ? stop.place[0] : stop.place,
  })) as (ItineraryStop & { place?: Place })[];

  return (
    <TripDashboard
      trip={trip as Trip}
      hotel={(hotel as Hotel) ?? null}
      places={(places as Place[]) ?? []}
      flights={(flights as Flight[]) ?? []}
      transport={(transport as TransportBooking[]) ?? []}
      itineraryDays={(itineraryDays as ItineraryDay[]) ?? []}
      itineraryStops={stopsWithPlaces}
      readOnly
    />
  );
}
