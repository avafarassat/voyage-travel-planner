/** Normalize a restaurant name to a short brand key for trip-wide dedupe. */
export function restaurantBrandKey(name: string): string {
  const base = name
    .toLowerCase()
    .split(/[|–—]/)[0]
    .replace(/\s+barcelona\b.*$/i, "")
    .trim();
  const words = base.replace(/&/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
}

export function isRestaurantBrandUsed(
  name: string,
  usedBrandKeys: Set<string>
): boolean {
  const key = restaurantBrandKey(name);
  return key.length > 0 && usedBrandKeys.has(key);
}

export function registerRestaurantBrand(
  name: string,
  usedBrandKeys: Set<string>
): void {
  const key = restaurantBrandKey(name);
  if (key) usedBrandKeys.add(key);
}
