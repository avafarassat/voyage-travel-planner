export interface ParsedDestination {
  city: string;
  country: string | null;
}

/** Derive city and country from a Places Text Search result (name + formatted address). */
export function parseDestinationFromPlace(
  name: string,
  address: string
): ParsedDestination {
  const city = name.trim();
  const country = parseCountryFromAddress(address);
  return { city, country };
}

function parseCountryFromAddress(address: string): string | null {
  if (!address?.trim()) return null;

  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (looksLikePostalSegment(part)) continue;
    return part;
  }

  return null;
}

function looksLikePostalSegment(segment: string): boolean {
  if (/^\d[\d\s-]*$/.test(segment)) return true;
  if (/^[A-Z0-9]{2,4}\s?\d[\dA-Z\s-]{2,}$/i.test(segment)) return true;
  return false;
}

/** Fill trip name when empty or still mirroring the destination the user typed. */
export function shouldAutoFillTripName(
  currentName: string,
  destinationBeforeSelect: string,
  selectedCity: string
): boolean {
  const trimmedName = currentName.trim();
  if (!trimmedName) return true;

  const lowerName = trimmedName.toLowerCase();
  const lowerDest = destinationBeforeSelect.trim().toLowerCase();
  const lowerCity = selectedCity.trim().toLowerCase();

  return lowerName === lowerDest || lowerName === lowerCity;
}
