/**
 * Visible category normalization fixtures.
 * Run: npx tsx scripts/verify-visible-category.ts
 */
import {
  getPlaceDisplayStyle,
  resolveVisibleItineraryCategory,
  type VisibleItineraryCategory,
} from "../lib/itinerary/visible-category";
import type { PlaceCategory } from "../lib/types";

type Fixture = {
  name: string;
  types?: string[];
  category?: PlaceCategory;
  poolTags?: import("../lib/types").PoolTag[];
  expected: VisibleItineraryCategory;
  emoji: string;
};

const FIXTURES: Fixture[] = [
  {
    name: "La Boqueria",
    types: ["market", "food", "tourist_attraction"],
    category: "activity",
    expected: "food_market",
    emoji: "🥐",
  },
  {
    name: "Mercat de Sant Josep",
    types: ["food", "point_of_interest"],
    category: "activity",
    expected: "food_market",
    emoji: "🥐",
  },
  {
    name: "Park Güell",
    types: ["park", "tourist_attraction"],
    category: "monument",
    expected: "parks_outdoors",
    emoji: "🌳",
  },
  {
    name: "Ciutadella Park",
    types: ["park", "tourist_attraction"],
    category: "monument",
    expected: "parks_outdoors",
    emoji: "🌳",
  },
  {
    name: "Picasso Museum",
    types: ["museum", "tourist_attraction"],
    category: "museum",
    expected: "museum",
    emoji: "🏛️",
  },
  {
    name: "Casa Batlló",
    types: ["tourist_attraction", "point_of_interest"],
    category: "monument",
    expected: "monument",
    emoji: "📍",
  },
  {
    name: "Paradiso",
    types: ["bar", "night_club"],
    category: "bar",
    expected: "bars_nightlife",
    emoji: "🍸",
  },
  {
    name: "El Nacional",
    types: ["restaurant", "food"],
    category: "restaurant",
    expected: "restaurant",
    emoji: "🍽️",
  },
  {
    name: "La Maquinista",
    types: ["shopping_mall", "store"],
    category: "activity",
    expected: "shopping",
    emoji: "🛍️",
  },
  {
    name: "Barcelona Walking Tour",
    types: ["travel_agency", "tourist_attraction"],
    category: "activity",
    expected: "activity",
    emoji: "🎤",
  },
];

let failed = 0;

for (const fixture of FIXTURES) {
  const input = {
    name: fixture.name,
    googleTypes: fixture.types,
    category: fixture.category,
    poolTags: fixture.poolTags,
  };
  const visible = resolveVisibleItineraryCategory(input);
  const style = getPlaceDisplayStyle(input);

  if (visible !== fixture.expected || style.emoji !== fixture.emoji) {
    console.error(
      `✗ ${fixture.name}: got ${visible} ${style.emoji}, expected ${fixture.expected} ${fixture.emoji}`
    );
    failed++;
  } else {
    console.log(`✓ ${fixture.name} → ${style.emoji} ${style.label}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} fixture(s) failed`);
  process.exit(1);
}

console.log(`\nAll ${FIXTURES.length} visible category fixtures passed.`);
