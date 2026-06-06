/**
 * Handoff verification for Barcelona test trip.
 * Usage: node scripts/verify-handoff.mjs
 * Reads .env.local for Supabase credentials (no secrets printed).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const TRIP_ID = "8ed96750-9eaa-4f81-9967-72da883cae74";
const PARK_GUELL_GID = "ChIJq0HUUq6ipBIRWM6qGqALmok";
const SAGRADA_GID = "ChIJk_s92NyipBIRUMnDG8Kq2Js";

function loadEnv() {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  return env;
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function pass(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    ${detail}`);
}
function warn(label, detail) {
  console.log(`  ⚠ ${label}`);
  if (detail) console.log(`    ${detail}`);
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or key in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);
const usingServiceRole = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nVoyage handoff verification");
console.log("===========================");
console.log(`Trip: ${TRIP_ID}`);
console.log(`Auth: ${usingServiceRole ? "service role" : "anon (RLS may block)"}\n`);

// 1. Migration 006
console.log("1. Migration 006 (is_completed)");
const mig = await supabase.from("itinerary_stops").select("is_completed").limit(1);
if (mig.error?.message?.includes("is_completed")) {
  fail("is_completed column missing — run migration 006");
} else if (mig.error) {
  warn("Could not verify is_completed", mig.error.message);
} else {
  pass("is_completed column exists");
}

if (!usingServiceRole) {
  console.log("\n⚠ No SUPABASE_SERVICE_ROLE_KEY — skipping data checks (RLS).");
  console.log("  Add service role to .env.local or verify in the app UI.\n");
  process.exit(0);
}

// 2. Manual places
console.log("\n2. Manual places scheduled");
const { data: manualPlaces, error: mpErr } = await supabase
  .from("places")
  .select("id, name, google_place_id, source")
  .eq("trip_id", TRIP_ID)
  .eq("source", "manual");

if (mpErr) {
  fail("Could not load manual places", mpErr.message);
} else {
  const manualCount = manualPlaces?.length ?? 0;
  console.log(`  Manual places in DB: ${manualCount}`);

  const { data: days } = await supabase
    .from("itinerary_days")
    .select("id, date")
    .eq("trip_id", TRIP_ID);

  const dayIds = (days ?? []).map((d) => d.id);
  const { data: stops } = await supabase
    .from("itinerary_stops")
    .select("place_id, scheduled_time, itinerary_day_id, places(name, google_place_id, source)")
    .in("itinerary_day_id", dayIds);

  const manualIds = new Set((manualPlaces ?? []).map((p) => p.id));
  const scheduledManual = new Set();
  for (const s of stops ?? []) {
    if (manualIds.has(s.place_id)) scheduledManual.add(s.place_id);
  }

  if (scheduledManual.size === manualCount) {
    pass(`All ${manualCount} manual places appear on itinerary`);
  } else {
    const missing = (manualPlaces ?? []).filter((p) => !scheduledManual.has(p.id));
    fail(
      `${scheduledManual.size}/${manualCount} manual places scheduled`,
      `Missing: ${missing.map((p) => p.name).join(", ")}`
    );
  }

  const sagrada = (manualPlaces ?? []).find((p) => p.google_place_id === SAGRADA_GID);
  if (sagrada && scheduledManual.has(sagrada.id)) {
    pass("Sagrada Família scheduled");
  } else if (sagrada) {
    fail("Sagrada Família not on itinerary");
  }
}

// 3. Park Güell dedup
console.log("\n3. Park Güell dedup");
const parkStops = (stops ?? []).filter(
  (s) => s.places?.google_place_id === PARK_GUELL_GID
);
if (parkStops.length === 1) {
  pass("Park Güell appears exactly once");
} else if (parkStops.length === 0) {
  warn("Park Güell not found on itinerary");
} else {
  fail(`Park Güell appears ${parkStops.length} times`);
}

// 4. Soma opening time
console.log("\n4. Soma restaurant time");
const somaStops = (stops ?? []).filter((s) =>
  /soma/i.test(s.places?.name ?? "")
);
for (const s of somaStops) {
  const mins = timeToMinutes(s.scheduled_time?.slice(0, 5));
  if (mins != null && mins >= 9 * 60) {
    pass(`Soma at ${s.scheduled_time?.slice(0, 5)} (≥ 9:00)`);
  } else {
    fail(`Soma at ${s.scheduled_time?.slice(0, 5) ?? "?"} — should be ≥ 9:00`);
  }
}
if (somaStops.length === 0) warn("No Soma stop found");

// 5. Late evening outdoor/tours
console.log("\n5. Late evening activities (after 18:30)");
const latePatterns =
  /hike|trail|passeig|aigües|aigues|tour|excursion|montserrat|park|nature/i;
let lateCount = 0;
for (const s of stops ?? []) {
  const name = s.places?.name ?? "";
  const cat = s.places?.category;
  if (!latePatterns.test(name) && cat !== "activity") continue;
  const mins = timeToMinutes(s.scheduled_time?.slice(0, 5));
  if (mins != null && mins > 18 * 60 + 30) {
    lateCount++;
    fail(`Late stop: ${name} at ${s.scheduled_time?.slice(0, 5)}`);
  }
}
if (lateCount === 0) pass("No obvious late outdoor/tour stops after 18:30");

// 6. Jul 3 layout
console.log("\n6. Jul 3 day layout");
const jul3 = (days ?? []).find((d) => d.date === "2026-07-03");
if (jul3) {
  const jul3Stops = (stops ?? [])
    .filter((s) => s.itinerary_day_id === jul3.id)
    .sort((a, b) => (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? ""));
  const times = jul3Stops.map(
    (s) => `${s.scheduled_time?.slice(0, 5) ?? "?"} ${s.places?.name ?? "?"}`
  );
  console.log("  Stops:");
  for (const t of times) console.log(`    ${t}`);
  const tourLate = jul3Stops.filter(
    (s) =>
      /tour/i.test(s.places?.name ?? "") &&
      timeToMinutes(s.scheduled_time?.slice(0, 5)) > 22 * 60
  );
  if (tourLate.length === 0) {
    pass("Jul 3 has no tours after 22:00");
  } else {
    fail("Jul 3 has late-night tours", tourLate.map((s) => s.places?.name).join(", "));
  }
} else {
  warn("Jul 3 itinerary day not found");
}

console.log("\nDone.\n");
