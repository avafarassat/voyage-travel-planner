import { haversineDistance } from "@/lib/itinerary/generate";
import type { Hotel, Place } from "@/lib/types";

/** Build map bounds from the main place cluster, skipping geographic outliers. */
export function boundsForMapContent(
  hotel: Hotel | null,
  places: Place[],
  destinationCenter?: { lat: number; lng: number } | null
): google.maps.LatLngBounds | null {
  if (places.length === 0) {
    if (hotel) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: hotel.lat, lng: hotel.lng });
      return bounds;
    }
    if (destinationCenter) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(destinationCenter);
      return bounds;
    }
    return null;
  }

  const centroid = {
    lat: places.reduce((sum, p) => sum + p.lat, 0) / places.length,
    lng: places.reduce((sum, p) => sum + p.lng, 0) / places.length,
  };

  const withDistance = places
    .map((place) => ({
      place,
      km: haversineDistance(centroid, { lat: place.lat, lng: place.lng }),
    }))
    .sort((a, b) => a.km - b.km);

  const medianKm = withDistance[Math.floor(withDistance.length / 2)]?.km ?? 0;
  const cutoffKm = Math.min(25, Math.max(medianKm * 2.5, 8));

  const bounds = new google.maps.LatLngBounds();
  for (const { place, km } of withDistance) {
    if (km <= cutoffKm) {
      bounds.extend({ lat: place.lat, lng: place.lng });
    }
  }

  if (hotel) {
    const hotelKm = haversineDistance(centroid, { lat: hotel.lat, lng: hotel.lng });
    if (hotelKm <= cutoffKm || bounds.isEmpty()) {
      bounds.extend({ lat: hotel.lat, lng: hotel.lng });
    }
  }

  if (bounds.isEmpty()) {
    for (const { place } of withDistance) {
      bounds.extend({ lat: place.lat, lng: place.lng });
    }
    if (hotel) bounds.extend({ lat: hotel.lat, lng: hotel.lng });
  }

  return bounds;
}

export function fitMapToContent(
  map: google.maps.Map,
  hotel: Hotel | null,
  places: Place[],
  padding = 48,
  destinationCenter?: { lat: number; lng: number } | null
): void {
  if (!hotel && places.length === 0 && destinationCenter) {
    map.setCenter(destinationCenter);
    map.setZoom(11);
    return;
  }

  const bounds = boundsForMapContent(hotel, places, destinationCenter);
  if (!bounds || bounds.isEmpty()) return;

  map.fitBounds(bounds, padding);

  google.maps.event.addListenerOnce(map, "idle", () => {
    const zoom = map.getZoom() ?? 13;
    const minZoom = places.length <= 1 ? 14 : 12;
    const maxZoom = 16;
    const clamped = Math.min(maxZoom, Math.max(minZoom, zoom));
    if (clamped !== zoom) {
      map.setZoom(clamped);
    }
  });
}
