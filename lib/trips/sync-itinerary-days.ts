import type { SupabaseClient } from "@supabase/supabase-js";
import { getTripDates } from "@/lib/types";

export interface SyncItineraryDaysResult {
  updated: number;
  added: number;
  removed: number;
}

/** Align itinerary_days rows with a trip's date range (keeps stops on surviving days). */
export async function syncItineraryDaysForTripDates(
  supabase: SupabaseClient,
  tripId: string,
  startDate: string,
  endDate: string
): Promise<SyncItineraryDaysResult> {
  const newDates = getTripDates(startDate, endDate);

  const { data: existingDays } = await supabase
    .from("itinerary_days")
    .select("id, day_number, date")
    .eq("trip_id", tripId)
    .order("day_number");

  if (!existingDays?.length) {
    return { updated: 0, added: 0, removed: 0 };
  }

  const existingByNumber = new Map(existingDays.map((d) => [d.day_number, d]));
  let updated = 0;
  let added = 0;

  for (let i = 0; i < newDates.length; i++) {
    const dayNumber = i + 1;
    const date = newDates[i];
    const existing = existingByNumber.get(dayNumber);

    if (existing) {
      if (existing.date !== date) {
        await supabase.from("itinerary_days").update({ date }).eq("id", existing.id);
        updated++;
      }
    } else {
      await supabase.from("itinerary_days").insert({
        trip_id: tripId,
        day_number: dayNumber,
        date,
      });
      added++;
    }
  }

  const toRemove = existingDays.filter((d) => d.day_number > newDates.length);
  if (toRemove.length > 0) {
    await supabase
      .from("itinerary_days")
      .delete()
      .in(
        "id",
        toRemove.map((d) => d.id)
      );
  }

  return { updated, added, removed: toRemove.length };
}

/** Drop place reservations that fall outside the new trip window. */
export async function clearOutOfRangeReservations(
  supabase: SupabaseClient,
  tripId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { data: places } = await supabase
    .from("places")
    .select("id, reservation_date")
    .eq("trip_id", tripId)
    .not("reservation_date", "is", null);

  const outOfRange =
    places?.filter(
      (p) =>
        p.reservation_date &&
        (p.reservation_date < startDate || p.reservation_date > endDate)
    ) ?? [];

  if (outOfRange.length === 0) return 0;

  await supabase
    .from("places")
    .update({ reservation_date: null, reservation_time: null })
    .in(
      "id",
      outOfRange.map((p) => p.id)
    );

  return outOfRange.length;
}
