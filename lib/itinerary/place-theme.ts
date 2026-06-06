import type { Place } from "@/lib/types";

const MARKET_PATTERN = /mercat|market|encants|boqueria|mercado/i;
const PARK_PATTERN = /park|parc|jardí|garden|jardin/i;
const EXPERIENCE_PATTERN =
  /tour|class|tasting|workshop|experience|crawl|masterclass|kayak|segway/i;

/** Group places into themes so similar stops aren't bunched on one day. */
export function placeTheme(name: string, category: Place["category"]): string {
  if (MARKET_PATTERN.test(name)) return "market";
  if (PARK_PATTERN.test(name)) return "park";
  if (EXPERIENCE_PATTERN.test(name)) return "experience";
  if (category === "museum") return "museum";
  if (category === "monument") return "monument";
  if (category === "restaurant") return "restaurant";
  if (category === "bar" || category === "nightlife") return "nightlife";
  return "activity";
}

/** Max optional stops sharing the same theme on one day (reservations exempt). */
export const MAX_SAME_THEME_PER_DAY = 1;

export function themeAllowed(dayThemes: Set<string>, name: string, category: Place["category"]): boolean {
  return !dayThemes.has(placeTheme(name, category));
}

export function recordTheme(
  dayThemes: Set<string>,
  name: string,
  category: Place["category"]
): void {
  dayThemes.add(placeTheme(name, category));
}
