import type { LatLng, Place } from "@/lib/types";
import { placeHasReservation } from "@/lib/utils";

export function haversineDistance(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function kMeansCluster(points: Place[], k: number, homeBase: LatLng): Place[][] {
  if (points.length === 0) return [];
  if (points.length <= k) {
    return points.map((p) => [p]);
  }

  const centroids: LatLng[] = [];
  centroids.push(homeBase);
  for (let i = 1; i < k; i++) {
    const idx = Math.floor((points.length / k) * i);
    centroids.push({ lat: points[idx].lat, lng: points[idx].lng });
  }

  let clusters: Place[][] = Array.from({ length: k }, () => []);

  for (let iter = 0; iter < 20; iter++) {
    clusters = Array.from({ length: k }, () => []);

    for (const point of points) {
      let minDist = Infinity;
      let clusterIdx = 0;
      for (let c = 0; c < k; c++) {
        const dist = haversineDistance(point, centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          clusterIdx = c;
        }
      }
      clusters[clusterIdx].push(point);
    }

    for (let c = 0; c < k; c++) {
      if (clusters[c].length === 0) continue;
      centroids[c] = {
        lat: clusters[c].reduce((s, p) => s + p.lat, 0) / clusters[c].length,
        lng: clusters[c].reduce((s, p) => s + p.lng, 0) / clusters[c].length,
      };
    }
  }

  return clusters.filter((c) => c.length > 0);
}

export function orderByNearestNeighbor(places: Place[], start: LatLng): Place[] {
  if (places.length <= 1) return places;

  const remaining = [...places];
  const ordered: Place[] = [];
  let current = start;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(current, remaining[i]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }

  return ordered;
}

function compareReservationTime(a: Place, b: Place): number {
  return (a.reservation_time ?? "").localeCompare(b.reservation_time ?? "");
}

/** Order a day's stops, anchoring reserved places at their booked times. */
export function orderDayStops(places: Place[], homeBase: LatLng): Place[] {
  const reserved = places.filter(placeHasReservation).sort(compareReservationTime);
  const unreserved = places.filter((p) => !placeHasReservation(p));

  if (reserved.length === 0) return orderByNearestNeighbor(unreserved, homeBase);
  if (unreserved.length === 0) return reserved;

  const result: Place[] = [];
  let current = homeBase;
  let remaining = [...unreserved];

  for (const anchor of reserved) {
    for (let n = 0; n < 2 && remaining.length > 0; n++) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = haversineDistance(current, remaining[i]);
        if (dist < bestDist && dist < 2) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      const next = remaining.splice(bestIdx, 1)[0];
      result.push(next);
      current = { lat: next.lat, lng: next.lng };
    }
    result.push(anchor);
    current = { lat: anchor.lat, lng: anchor.lng };
  }

  result.push(...orderByNearestNeighbor(remaining, current));
  return result;
}

export interface GeneratedDay {
  dayNumber: number;
  date: string;
  places: Place[];
}

export function generateItinerary(
  places: Place[],
  dates: string[],
  homeBase: LatLng
): GeneratedDay[] {
  const k = dates.length;
  if (places.length === 0) {
    return dates.map((date, i) => ({ dayNumber: i + 1, date, places: [] }));
  }

  const reservedOnTrip = places.filter(
    (p) => placeHasReservation(p) && dates.includes(p.reservation_date!)
  );
  const unreserved = places.filter(
    (p) => !placeHasReservation(p) || !dates.includes(p.reservation_date!)
  );

  const dayBuckets: Place[][] = dates.map(() => []);

  for (const place of reservedOnTrip) {
    const dayIdx = dates.indexOf(place.reservation_date!);
    dayBuckets[dayIdx].push(place);
  }

  if (unreserved.length > 0) {
    const clusters = kMeansCluster(unreserved, k, homeBase);

    const clusterSizes = clusters.map((c) => c.length);
    while (clusters.length < k) {
      const largestIdx = clusterSizes.indexOf(Math.max(...clusterSizes));
      const largest = clusters[largestIdx];
      if (largest.length <= 1) break;
      const mid = Math.ceil(largest.length / 2);
      clusters.push(largest.splice(mid));
      clusterSizes[largestIdx] = largest.length;
      clusterSizes.push(clusters[clusters.length - 1].length);
    }

    clusters.forEach((cluster, i) => {
      if (i < k) dayBuckets[i].push(...cluster);
    });
  }

  return dates.map((date, i) => ({
    dayNumber: i + 1,
    date,
    places: orderDayStops(dayBuckets[i], homeBase),
  }));
}

export function estimateWalkMinutes(from: LatLng, to: LatLng): number {
  const km = haversineDistance(from, to);
  return Math.max(1, Math.round((km / 5) * 60));
}
