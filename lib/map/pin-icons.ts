import type { PlaceCategory } from "@/lib/types";

/** Shrink markers when zoomed out so they don't dominate the map. */
export function zoomFactor(zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 13;
  return Math.min(1, Math.max(0.4, (z - 8) / 6));
}

function pinBody(color: string): string {
  return (
    `<path d="M16 0C9.925 0 5 4.925 5 11c0 8.25 11 29 11 29s11-20.75 11-29C27 4.925 22.075 0 16 0z" ` +
    `fill="${color}" stroke="#FFFFFF" stroke-width="1.25" stroke-linejoin="round"/>`
  );
}

const HOTEL_ICON =
  '<path d="M16 9.5 10.5 14v6h3v-3.5h5V20h3v-6L16 9.5z" fill="#FFFFFF"/>';

/** White icon paths centered in the pin head — one per place category. */
const CATEGORY_ICONS: Record<PlaceCategory, string> = {
  // Fork over a plate arc
  restaurant:
    '<path d="M11.2 17a4.8 4.8 0 0 0 9.6 0" fill="none" stroke="#FFFFFF" stroke-width="1.45" stroke-linecap="round"/>' +
    '<path d="M14.1 10.8v2.5M15.6 10.8v2.5M17.1 10.8v2.5M15.6 13.3v4.2" stroke="#FFFFFF" stroke-width="1.25" stroke-linecap="round"/>',
  // Wine glass — wide bowl, stem, base
  bar:
    '<path d="M12.2 11.8h7.6L16 17.8z" fill="#FFFFFF"/>' +
    '<rect x="15.1" y="17.8" width="1.8" height="2.4" fill="#FFFFFF"/>' +
    '<rect x="12.8" y="20" width="6.4" height="1" rx="0.5" fill="#FFFFFF"/>',
  // Star — reads clearly at pin size
  nightlife:
    '<path d="M16 10.5 17.3 13.8 20.8 14.1 18.1 16.4 19 19.7 16 17.8 13 19.7 13.9 16.4 11.2 14.1 14.7 13.8 16 10.5Z" fill="#FFFFFF"/>',
  // Person walking
  activity:
    '<circle cx="16" cy="11.3" r="1.7" fill="#FFFFFF"/>' +
    '<path d="M16 13.2v3.2M14.3 15.2l-1.8 3.8M17.7 15.2l2.2 3.8M16 14.3l-2.8 2.2M16 14.3l3.2 1.5" fill="none" stroke="#FFFFFF" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>',
  // Map pin landmark
  monument:
    '<path d="M16 10.2a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z" fill="#FFFFFF"/>' +
    '<path d="M16 16v3.8" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/>',
  // Classical museum — pediment + columns
  museum:
    '<path d="M10.5 14.2 16 10.2 21.5 14.2Z" fill="#FFFFFF"/>' +
    '<rect x="11.2" y="14.2" width="2" height="5.8" fill="#FFFFFF"/>' +
    '<rect x="15" y="14.2" width="2" height="5.8" fill="#FFFFFF"/>' +
    '<rect x="18.8" y="14.2" width="2" height="5.8" fill="#FFFFFF"/>' +
    '<rect x="10.2" y="19.8" width="11.6" height="1.1" fill="#FFFFFF"/>',
};

function buildPinSvg(color: string, innerIcon: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40">` +
    `${pinBody(color)}${innerIcon}</svg>`
  );
}

function pinIcon(
  color: string,
  innerIcon: string,
  zoom: number,
  baseW: number,
  baseH: number
): google.maps.Icon {
  const factor = zoomFactor(zoom);
  const w = Math.max(1, Math.round(baseW * factor));
  const h = Math.max(1, Math.round(baseH * factor));
  const svg = buildPinSvg(color, innerIcon);
  return {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    scaledSize: { width: w, height: h } as google.maps.Size,
    anchor: { x: w / 2, y: h } as google.maps.Point,
  };
}

export function createHotelPinIcon(zoom: number): google.maps.Icon {
  return pinIcon("#7C3AED", HOTEL_ICON, zoom, 32, 40);
}

export function createPlacePinIcon(
  color: string,
  category: PlaceCategory,
  zoom: number
): google.maps.Icon {
  return pinIcon(color, CATEGORY_ICONS[category], zoom, 28, 35);
}

/** Inline SVG string for legend previews (no google.maps dependency). */
export function legendPinSvg(color: string, category?: PlaceCategory): string {
  const icon =
    category === undefined ? HOTEL_ICON : CATEGORY_ICONS[category];
  return buildPinSvg(color, icon);
}
