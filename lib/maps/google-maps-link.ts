function mapsSearchQuery(
  name: string,
  address: string | null | undefined
): string | null {
  const trimmedName = name.trim();
  const trimmedAddress = address?.trim();
  if (trimmedName && trimmedAddress) return `${trimmedName} ${trimmedAddress}`;
  if (trimmedName) return trimmedName;
  if (trimmedAddress) return trimmedAddress;
  return null;
}

export function isValidGoogleMapsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "maps.google.com" ||
      host === "www.google.com" ||
      host === "google.com" ||
      host.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}

export function buildGoogleMapsSearchUrl(options: {
  googleMapsUrl?: string;
  placeId?: string;
  name: string;
  address?: string | null;
}): string | null {
  if (options.googleMapsUrl && isValidGoogleMapsUrl(options.googleMapsUrl)) {
    return options.googleMapsUrl;
  }

  const query = mapsSearchQuery(options.name, options.address);

  if (options.placeId && query) {
    const params = new URLSearchParams({
      api: "1",
      query,
      query_place_id: options.placeId,
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  if (query) {
    const params = new URLSearchParams({ api: "1", query });
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  return null;
}
