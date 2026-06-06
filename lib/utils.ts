import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Format a Postgres time string (HH:MM:SS) for display. */
export function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":");
  const d = new Date();
  d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function placeHasReservation(place: {
  reservation_date: string | null;
}): boolean {
  return !!place.reservation_date;
}

export function isManualPlace(place: { source: string }): boolean {
  return place.source === "manual";
}

export function formatPlaceReservation(place: {
  reservation_date: string | null;
  reservation_time?: string | null;
}): string | null {
  if (!place.reservation_date) return null;
  const date = formatDate(place.reservation_date);
  const time = place.reservation_time ? formatTime(place.reservation_time) : null;
  return time ? `Reserved · ${date} · ${time}` : `Reserved · ${date}`;
}

/** User-set reservation time wins over a chained schedule time on the same day. */
export function pinnedStopScheduledTime(
  scheduledTime: string | null | undefined,
  place: {
    reservation_date?: string | null;
    reservation_time?: string | null;
  } | null | undefined,
  dayDate: string
): string | null | undefined {
  if (place?.reservation_time && place.reservation_date === dayDate) {
    return place.reservation_time;
  }
  return scheduledTime;
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function generateShareToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** True when the trip's end date is before today. */
export function isTripPast(endDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate + "T12:00:00");
  return end < today;
}
