import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlaceDetails } from "@/lib/itinerary/google-places";
import { hasUsableOpeningHours } from "@/lib/itinerary/hours";
import type { Place } from "@/lib/types";

/** Fetch and persist Google opening hours for places missing them (awaited before reschedule). */
export async function enrichPlacesOpeningHours(
  supabase: SupabaseClient,
  places: Place[],
  apiKey: string
): Promise<void> {
  await Promise.all(
    places
      .filter((p) => p.google_place_id && !hasUsableOpeningHours(p.opening_hours))
      .map(async (place) => {
        const details = await fetchPlaceDetails(place.google_place_id!, apiKey);
        if (!details?.openingHours) return;
        place.opening_hours = details.openingHours;
        await supabase
          .from("places")
          .update({ opening_hours: details.openingHours })
          .eq("id", place.id);
      })
  );
}

/** Refresh missing photos/hours in the background — not needed to build the schedule. */
export function enrichPlacesInBackground(
  supabase: SupabaseClient,
  places: Place[],
  city: string,
  apiKey: string
) {
  void import("@/lib/itinerary/google-places").then(({ resolvePlacePhoto }) =>
    Promise.all(
      places.map(async (place) => {
        const needsHours =
          place.google_place_id && !hasUsableOpeningHours(place.opening_hours);
        const needsPhoto = !place.photo_url;

        if (needsHours && place.google_place_id) {
          const details = await fetchPlaceDetails(place.google_place_id, apiKey);
          if (details?.openingHours) {
            await supabase
              .from("places")
              .update({ opening_hours: details.openingHours })
              .eq("id", place.id);
          }
        }

        if (needsPhoto) {
          const resolved = await resolvePlacePhoto(place, city, apiKey);
          if (!resolved?.photoUrl) return;
          const patch: { photo_url: string; google_place_id?: string } = {
            photo_url: resolved.photoUrl,
          };
          if (!place.google_place_id && resolved.googlePlaceId) {
            patch.google_place_id = resolved.googlePlaceId;
          }
          await supabase.from("places").update(patch).eq("id", place.id);
        }
      })
    )
  );
}
