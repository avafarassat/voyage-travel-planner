# Voyage — project handoff

**Last updated:** 2026-06-15 (density repair before quality gate; next: late-day meal placement, then Phase D trip deck)  
**Primary cost-control reference:** [`COST_SAFETY_CHECKPOINT.md`](./COST_SAFETY_CHECKPOINT.md) — read this before any Google-related work.

---

## 1. Project overview

| | |
|---|---|
| **App name** | Voyage |
| **Stack** | Next.js 15, React 19, Supabase, Google Maps/Places, Tailwind |
| **Purpose** | Travel planning app: trips, itinerary (Plan), map, places, hotel home base, flights, transport, discover, share |
| **Main test trip** | Barcelona, July 1–12, 2026 |
| **Test trip ID** | `8ed96750-9eaa-4f81-9967-72da883cae74` |
| **Verify script** | `node scripts/verify-handoff.mjs` (reads `.env.local`); `npx tsx scripts/verify-visible-category.ts` (category fixtures) |

Trip dashboard tabs: **My Map**, **My Places** (mobile), **Plan**, **Flights**, **Transport**, **Hotel**, **Discover**, **Share**.

---

## 2. Current branch / status

| | |
|---|---|
| **Branch** | `main` |
| **Remote** | https://github.com/avafarassat/voyage-travel-planner.git |
| **Tag** | `cost-safety-checkpoint` → `a944d09` |

### Recent important commits

```
Repair low sightseeing days before quality gate
058a44d Add quality gate before replacing itinerary
e05ef3c Update handoff with pool-first and category progress
1a475bc Normalize itinerary category display
f4a5d51 Avoid live details in post-generate hydration
a6792d6 Avoid live details for schedule-usable generate places
a2cf1f1 Make generate place hydration stored-data first
adf9ac2 Use destination pool in itinerary post-passes
042143d Use restaurant pool to supplement meal candidates
79a054c Read destination candidate pool before Google top-up
f3e0af5 Cache generated Places candidates
68a360b Add candidate pool schema and types
23af94a Add request-scoped Places quota gate
293e420 Avoid prematurely exhausting itinerary candidates
b6f28e4 Order rescheduled itinerary stops chronologically
3945efc Preserve stops when adding rest blocks and reschedule around them
a944d09 Gate photo features and improve place detail fallbacks
1352917 Add estimated travel times to avoid automatic Directions API calls
```

Older narrative context may exist in `PROJECT_CONTEXT_V3.md.txt`. For cost controls and env flags, **`COST_SAFETY_CHECKPOINT.md` is the source of truth.**

---

## 3. Cost-safety rules

**Always read [`COST_SAFETY_CHECKPOINT.md`](./COST_SAFETY_CHECKPOINT.md) before touching Google-related features.**

### Do not (unless Ava explicitly asks)

- Run **Generate** itinerary repeatedly (heavy Google Places usage — **one controlled test at a time**).
- Call **Google Directions API** (Plan uses local coordinate estimates only). Keep Directions at **0/day** or disabled.
- Add **automatic** Google Places / Details / Photo calls on page or tab load.
- Commit **`.env.local`** (secrets and local flags).

### Do

- Keep **searches user-initiated** (button click, explicit typing in autocomplete).
- Use **small, focused commits** by feature.
- Check `git status --short` before and after changes.
- Smoke-test with **mock modes** when Google quota is exhausted (see env flags below).
- Raise **Maps JavaScript** quota cautiously if needed for visual map testing only.
- **Generate empty guard:** when Places returns no candidates, Generate fails with a friendly error and does **not** wipe an existing itinerary (see §8).
- **Generate uses Places** when the button is clicked — test sparingly; prefer reading server logs from a single run over re-running Generate. **Do not repeatedly click Generate** while debugging; one controlled test at a time.
- **Plan travel times** stay on **local coordinate estimates** only (`lib/itinerary/travel.ts`) — no Directions API from Plan UI. **Do not call Google Directions.**
- **No automatic Places calls on page load** — searches remain user-initiated (Generate button, autocomplete typing, Discover search, etc.).
- **Generate reads saved pool first (Phases C–C.2).** Main Generate and post-passes (`fill-sparse`, `ensure-meals`) load `destination_place_candidates` before live Google. Live Places is used **only to top up true shortfalls** when saved inventory is insufficient and quota allows. **`refresh-suggestion`** is not pool-first yet.
- **Pre-generate hydration is stored-data-first (Phase C.3 / C.3.1).** Generate no longer calls `enrichPlacesInBackground` before scheduling. Opening hours come from stored DB → destination pool → live `fetchPlaceDetails` (quota-gated last resort only). **Schedule-usable places skip live details** even when opening hours are missing. **No photo backfill during Generate.**
- **Post-generate hydration is stored/pool-first (Phase C.3.2).** After `fill-sparse` and `ensure-meals`, `enrichPlacesOpeningHours` shares the same hydration path — stored DB → destination pool → live details only when not schedule-usable and quota allows. **No photo backfill. No parallel details burst.**
- **Quota gate (Phase B′):** once `OVER_QUERY_LIMIT` or `RESOURCE_EXHAUSTED` is detected in a Generate request, later live Places calls in that same request are skipped — including `fill-sparse`, `ensure-meals`, meal searches, and details hydration.
- **Density repair (pre–quality-gate):** low-sightseeing recovery uses saved in-memory pools only (`interestPool`, `parksPool`, `experiencesPool`) — **no live Google calls**, no Directions, no retries.
- **Pool refresh (future)** must be **explicit, scheduled, or admin-controlled** — not uncontrolled per page load or per Plan mount.
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only; required for global candidate pool read/write (see §8). Documented in `.env.example`. **Never commit `.env.local`.** Key is present locally in `.env.local` for dev pool operations.

### Env flags (local `.env.local`)

Restart dev server after changing any `NEXT_PUBLIC_*` flag.

```env
# Photo proxy + client fallbacks (quota protection)
DISABLE_PLACE_PHOTO_PROXY=true
NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY=true

# Auto fill-sparse on Plan mount (quota protection)
DISABLE_AUTO_FILL_SPARSE=true
NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true

# Local hotel explore UI testing only — no Places calls
NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE=true

# Create Trip destination autocomplete — no Places calls
NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE=true
```

Documented in `.env.example`. **Never commit `.env.local`.**

While mock modes are enabled, **Places quota can stay low**. Maps JS may still load for TripMap / hotel explore visuals — watch for `OverQuotaMapError` if Maps quota is exhausted.

### What not to casually change

Scheduling, generate logic, meal placement, Directions routes, travel-time estimation, photo proxy internals, fill-sparse algorithm, itinerary placement — unless the task explicitly requires it.

---

## 4. Create Trip — current state

**Key files:** `app/trips/new/page.tsx`, `components/trip/place-autocomplete-input.tsx`, `lib/maps/parse-destination.ts`, `lib/maps/mock-destination-autocomplete.ts`, `app/api/places/autocomplete/route.ts` (`type=destination`)

### Destination autocomplete

- **Destination** field with dropdown suggestions (user-initiated typing only; no search on page load).
- Selecting a destination fills **City** and **Country**; **Trip name** auto-fills when empty or still mirroring typed destination.
- **Manual city/country entry** still works if autocomplete fails or quota is unavailable.
- Stale auto-filled **country** clears when destination text changes without a new selection; manually edited country is preserved.

### Mock mode

- `NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE=true` → hardcoded destinations (Lake Como, Florence, Paris, Barcelona, Tokyo, New York); **zero** `/api/places/autocomplete` calls.
- Friendly message when real search fails: manual entry still works.

### Destination coordinates

- Migration: `supabase/migrations/007_trip_destination_coords.sql` adds nullable `destination_lat`, `destination_lng` on `trips`.
- **Must apply migration** before creating trips with stored coords.
- Coords saved from autocomplete selection at create time.
- If no coords on submit, **one** `/api/geocode` call at create time is allowed (not on map load).
- Geocode failure does not block trip creation — coords remain null.

### Date validation

- End date `min` = trip start date; same-day trips are valid.
- Submit blocked if end date is before start date.
- Invalid end date auto-corrects to start date when start date changes.

### Duplicate trip names

- Blocked per user before insert — case-insensitive, trim-aware (`lib/trips/trip-name.ts`).
- Friendly inline error on Trip name field; duplicate check runs before cover/geocode calls.
- App-level validation only for now; **DB unique index** is future hardening after cleaning any existing duplicates.

---

## 5. Trip map — current state

**Key files:** `components/map/TripMap.tsx`, `lib/map/fit-bounds.ts`, `components/trip/trip-dashboard.tsx`

- `trips` has nullable **`destination_lat`** / **`destination_lng`** (migration `007`).
- New trips center **My Map** on destination when no hotel/places exist (`fitMapToContent` → zoom 11).
- If **hotel or places** exist, existing fit-bounds behavior is unchanged.
- **Lake Como** (and other destinations) center correctly when coords were saved at create.
- **Existing trips** without coords fall back safely to Barcelona default when no markers exist.
- **No geocoding on map load** — coords read from DB only.

---

## 6. My Trips — current state

**Key files:** `app/trips/page.tsx`, `components/trip/trip-card.tsx`, `components/trip/trip-delete-dialog.tsx`

- Trip cards show **delete** (trash icon) alongside edit pencil on upcoming trips; delete on past trips too.
- Delete requires **confirmation** dialog with clear copy; Cancel does nothing.
- Delete uses Supabase client `trips` delete; related rows cascade via FK (`hotels`, `places`, `flights`, `transport_bookings`, `itinerary_days` → `itinerary_stops`).
- Friendly error if deletion fails; list refreshes via `router.refresh()`.
- **Duplicate names on create** are blocked; existing duplicates in DB may need **manual deletion** until a DB unique index is added.

---

## 7. Hotel tab — current state

**Key files:** `components/trip/hotel-section.tsx`, `components/trip/hotel-explore-panel.tsx`, `lib/maps/hotel-explore.ts`, `lib/maps/mock-hotel-explore.ts`, `lib/maps/google-maps-link.ts`

### Saved hotel

- Collapsed **summary** by default (name, address, check-in/out, notes).
- **Edit hotel** expands the full manual form (`PlaceAutocompleteInput` for lodging — searches only when user types).
- Saved check-in/check-out values are **preserved** when editing.

### No saved hotel

- Empty state with **Explore hotels** and **Enter manually**.

### Hotel dates (commit `b4699b5`)

- Manual entry and Explore selection **default check-in/check-out** to trip start/end dates when no saved hotel dates exist.
- Date inputs constrained to trip date range (`min`/`max` on native date inputs).
- Check-out adjusts to check-in if check-in moves past it (same-day valid).

### Explore hotels (commit `5ff1ccd`, mock update `d9035f3`)

- **User-initiated lodging search only** — no search on Hotel tab load or component mount.
- Click **Explore hotels** or **Search** → one `/api/places/autocomplete?type=lodging` call (unless mock flag is on).
- **List + map** layout; global side map hidden while exploring on desktop.
- Hotel **pins** on explore map; selected pin is **darker purple and larger** with anchor dot; info window offset so pin stays visible.
- **View on Google Maps** — outbound URL only (`lib/maps/google-maps-link.ts`), no app API call.
- **Select hotel** saves name, address, lat, lng (+ check-in/out/notes); calls `onUpdate()`; collapses to summary.
- Does **not** persist `google_place_id` (hotels table has no column).
- **Client-side filters only** (no API on filter change):
  - Minimum rating (Any, 4.0+, 4.5+, 4.7+)
  - Price level ($, $$, $$$, $$$$)
- **No nightly min/max filters** — real nightly pricing is not available from Google Places.
- **Quota-safe errors** — friendly message, not raw Google text; **Enter manually** + **Back** remain visible.

### Mock mode (commit `d9035f3`)

- `NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE=true` → **destination-aware** mock lists; zero Places calls.
  - **Barcelona** → Barcelona mock hotels
  - **Lake Como** → Lake Como mock hotels (Grand Hotel Tremezzo, Passalacqua, Mandarin Oriental, Villa d'Este, Hilton Lake Como, etc.)
  - **Unknown destinations** → friendly mock empty state (not Barcelona fallback)
- Search/filters in mock mode remain client-side only.

### Future — live hotel pricing

Connect a **real hotel pricing/booking provider** before adding nightly rate filters. **Do not** fake nightly prices from Google `priceLevel`. See `COST_SAFETY_CHECKPOINT.md` → Future roadmap.

---

## 8. Plan / itinerary — current state

**Key files:** `components/trip/itinerary-section.tsx`, `app/api/itinerary/generate/route.ts`, `lib/itinerary/smart-generate.ts`, `lib/itinerary/density-repair.ts`, `lib/itinerary/google-places.ts`, `lib/itinerary/places-quota-gate.ts`, `lib/itinerary/candidate-pool.ts`, `lib/itinerary/enrich-places.ts`, `lib/itinerary/pool-tags.ts`, `lib/itinerary/visible-category.ts`, `lib/itinerary/quality-gate.ts`, `lib/supabase/service.ts`, `lib/itinerary/reschedule-day.ts`, `lib/itinerary/apply-reschedule.ts`, `lib/itinerary/fill-sparse.ts`, `lib/itinerary/ensure-meals.ts`, `lib/itinerary/generate-diagnostics.ts`

### Core Plan behavior

- **Collapsible days** — Day 1 expanded by default; others collapsed (not persisted).
- **Travel times** — local estimates (`Est. walk` / `drive` / `transit`) via `estimateDisplayTravelLegs` in `lib/itinerary/travel.ts`. **No Directions API** from Plan UI.
- **Auto fill-sparse** gated by env flags — Plan mount does not POST `fill-sparse-days` when `NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true`. Note: **Generate** still calls `fillSparseDaysForTrip` directly server-side (not gated by that flag).
- **Generate** is explicit button action only; still heavy — do not run casually or repeatedly.
- **Generate safety guard (2026-06-15)** — protects users when Places quota is exhausted or Google returns empty candidate pools:
  - Generate **fails safely** when zero stops are produced.
  - `POST /api/itinerary/generate` returns a **friendly non-200** (503) if `stopCount === 0`, with a user-facing message about Places being unavailable or over quota.
  - **Existing itinerary rows are preserved** — delete/replace only runs after generated `stopCount > 0` is confirmed **and** the quality gate passes (see below).
  - On success, response includes `{ success: true, dayCount, stopCount, warning? }`. Optional **`warning`** describes missing meals on one or more days (non-blocking).
  - UI shows **“Itinerary ready!”** when generation succeeds and the quality gate allows persistence; meal **`warning`** may appear as toast description.
  - Quota/empty failures show the server error or a client fallback message instead.
  - Google Places **non-OK statuses** are logged server-side in `lib/itinerary/google-places.ts` (status, optional `error_message`, query context — no API keys).
- **Quality gate before replacing itinerary (2026-06-15, commit `058a44d`)** — see dedicated section below. Materially incomplete generated results **do not wipe** an existing itinerary; severe failures return **409** and preserve DB rows.
- Barcelona itinerary had prior fixes for **meal timing**, **anchors**, **opening-hours enrichment**, and **sparse-day rescheduling** (commits `f32cf6c`, `6385f77`).

### Rest blocks (commits `3945efc`, `b6f28e4`)

- Adding a **rest block** no longer deletes overlapping normal stops.
- Rest blocks are **fixed time windows**; other stops are **rescheduled around** them (`bumpPastRestIntervals` in `lib/itinerary/reschedule-day.ts`).
- **Removing** a rest block deletes only the rest row and reschedules the remaining day.
- After reschedule, stops are ordered **chronologically by computed `scheduled_time`**, and **`sort_order` is updated** to match (`chronologicalSortOrderUpdates` in `lib/itinerary/reschedule-day.ts`, used from `lib/itinerary/apply-reschedule.ts`).
- **Key files:** `app/api/itinerary/add-rest/route.ts`, `app/api/itinerary/remove-stop/route.ts`, `lib/itinerary/reschedule-day.ts`, `lib/itinerary/apply-reschedule.ts`.

### Candidate pool — Phase 1 fix (commit `293e420`)

Addresses later-day itinerary degradation from candidates marked “used” before they were actually placed.

- Candidate google IDs are **no longer marked used before successful placement**.
- **`pickSuggestion`**, **`pickBalancedActivitySuggestion`**, and **`pickMealSuggestion`** (`lib/itinerary/smart-generate.ts`) select candidates **without** mutating `usedGoogleIds`.
- **`pushStop` → `markStopPlaceUsed`** is the main successful-placement path for used marking in smart-generate (including meal brand registration).
- **`lib/itinerary/fill-sparse.ts`** marks candidates used only after successful persistence/addition (`persistMealCandidate`, activity top-up loop).
- Added **`lib/itinerary/generate-diagnostics.ts`** — server-side logs on Generate:
  - `[itinerary-generate] pools` — pool counts (`mealPrefetchSlots`, `restaurantPoolCount`, etc.)
  - `[itinerary-generate] day_below_target` — low stops / missing meals per day
  - `[itinerary-generate] result` — trip-level stop counts
- Typecheck passed: `npx tsc --noEmit`.
- Small type fixes bundled in same arc: `app/api/itinerary/refresh-suggestion/route.ts`, `app/api/itinerary/suggest-stop/route.ts` (pass `source` with `google_place_id` to exclusion helper).

**Not in Phase 1 (future phases):** neighborhood clustering, optional home base, full meal rhythm rewrite, regeneration overhaul. **Persistent candidate pools** are now the planned next architecture (see below).

### Phase 1.5 — meal fallback / diagnostics (implemented, uncommitted)

Added stronger **generated meal diagnostics** and **meal fallback** behavior without reverting Phase 1 used-marking. `npx tsc --noEmit` passed.

**Key files touched:**

- `app/api/itinerary/generate/route.ts`
- `components/trip/itinerary-section.tsx`
- `lib/itinerary/ensure-meals.ts`
- `lib/itinerary/fill-sparse.ts`
- `lib/itinerary/generate-diagnostics.ts`
- `lib/itinerary/smart-generate.ts`

**What changed:**

- **`addMeal` / `ensureRequiredMeals` / `topUpSparseDay`** — relaxed meal retry (wider window, allow duplicate brand before leaving meal missing, weak-hours tolerance when reliable hours absent); summarized rejection logging.
- **`fill-sparse` / `ensure-meals`** — strict then relaxed meal retry; logging when bounds or candidates fail.
- **Generate route** — post-pass missing-meals summary; optional non-blocking `warning` in JSON response.
- **UI** — success toast can show meal `warning` as description.

**Server logs added/verified (prefix `[itinerary-generate]` unless noted):**

| Log | Purpose |
|-----|---------|
| `[itinerary-generate] start` | Generate route entered |
| `[itinerary-generate] pools` | Candidate pool sizes at start |
| `[itinerary-generate] day_below_target` | Low stop count / missing meals / low sightseeing after scheduling |
| `[itinerary-generate] meal_not_placed` | Summarized meal rejection counts by phase |
| `[itinerary-generate] result` | Trip-level stop counts per day |
| `[itinerary-generate] missing_meals_after_generation` | Persisted meal gaps after all post-passes |
| `[fill-sparse]` | Sparse-day skip/failure reasons |
| `[ensure-meals]` | Post-generate meal insertion skip/failure reasons |
| `[itinerary-generate] quota_exhausted` | Quota gate tripped (Phase B′) |
| `[itinerary-generate] quota_skip` | Live Places fetch skipped after quota exhaustion |
| `[itinerary-generate] quota_gate_summary` | End-of-request quota skip totals |
| `[candidate-pool] destination_upserted` | Destination row upserted (Phase B) |
| `[candidate-pool] candidates_upserted` | Global candidates written; counts by source/tag |
| `[candidate-pool] upsert_failed` | Non-blocking pool write failure |
| `[candidate-pool] pool_read` | Global pool loaded for destination (Phase C) |
| `[candidate-pool] pool_shortfall` | Category/tag counts below threshold after restaurant meal fallback (Phase C/C.1) |
| `[candidate-pool] google_top_up` | Live Google top-up attempted/skipped; includes `skippedRestaurantFallback` (Phase C/C.1) |
| `[candidate-pool] pool_generate_inputs` | Final in-memory pool counts passed to scheduler; includes `fromGlobalPool` (Phase C) |
| `[candidate-pool] restaurant_meal_fallback` | General restaurant candidates added to meal pools before Google (Phase C.1) |
| `[candidate-pool] postpass_pool_read` | Post-pass pool load for fill-sparse / ensure-meals (Phase C.2) |
| `[fill-sparse] pool_candidates_used` | Saved pool candidates used for activity/meal top-up (Phase C.2) |
| `[ensure-meals] pool_candidates_used` | Saved pool meal candidates used (Phase C.2) |
| `[fill-sparse] live_fallback_skipped_pool_available` | Live Google skipped — saved pool or quota (Phase C.2) |
| `[ensure-meals] live_fallback_skipped_pool_available` | Live Google skipped — saved pool or quota (Phase C.2) |
| `[itinerary-generate] stored_place_hydration` | Pre-generate place hydration sources (Phase C.3 / C.3.1) |
| `[itinerary-generate] post_generate_place_hydration` | Post-generate hydration after fill-sparse / ensure-meals (Phase C.3.2) |
| `[itinerary-generate] quality_gate` | Quality gate severity, block status, reasons, generated/existing counts (commit `058a44d`) |
| `[itinerary-generate] density_repair_start` | Low-sightseeing day repair started; pool size, starting/target sightseeing counts |
| `[itinerary-generate] density_repair_added` | Saved-pool activity stop inserted during density repair |
| `[itinerary-generate] density_repair_skipped` | Day skipped by repair (e.g. excursion day) |
| `[itinerary-generate] density_repair_summary` | Per-day or trip-level repair outcome, skip reason counts, final sightseeing count |

**Assessment:** Meal fallback **improved** (breakfast/restaurants started appearing), but **did not fully solve itinerary quality** — especially under **Google Places quota exhaustion** (see below). Phase 1 used-marking semantics remain intact (`pushStop` → `markStopPlaceUsed`; no early `usedGoogleIds` in pickers).

### Controlled Generate result after Phase 1.5 (Barcelona test trip)

After Phase 1.5, a controlled Generate showed **restaurants/meals starting to appear**, but **day rhythm and density still degraded**.

**Example Day 1:** only **Breakfast Club Brunch Barcelona** (breakfast, ~9:30 AM) + **Park Güell** (monument, ~11:38 AM) — missing lunch, afternoon activity, dinner, and optional nightlife/bar.

**Diagnosis (not a reschedule regression):**

- The day was **under-built in memory** during `scheduleStandardDay` + `ensureRequiredMeals` + `topUpSparseDay`, not broken by `rescheduleAllItineraryDaysForTrip` (reschedule updates times only; does not delete stops).
- Phase 1.5 **fixed breakfast** (consumes morning window); earlier runs had **more activities but no meals**. The tradeoff exposed an **existing sparse-day weakness**, not a new reschedule bug.
- **`fill-sparse` / `ensure-meals`** did not reliably repair the day when live Google calls failed or quota was exhausted.

**Known sparse-day weaknesses (still open):**

| Weakness | Detail |
|----------|--------|
| Lunch/dinner can still fail | Hours, brand dedup, used Google ID, window/deadline — even after relaxed retry |
| Activity top-up gives up too early | `topUpSparseDay` breaks its activity loop on the **first** failed `addActivities` call |
| No full-day density guarantee | No hard minimum for B → AM activity → lunch → PM activity → dinner → optional bar |
| Misleading success UX | **Fixed for replacement** — quality gate blocks wipe when result is severely incomplete; minor issues still persist with warnings |

**Expected default day rhythm (normal non-excursion day):** breakfast → ≥1 morning activity → lunch → ≥1 afternoon activity → dinner → optional nightlife/bar if interest selected.

**Key meal / scheduler files:** `lib/itinerary/smart-generate.ts`, `lib/itinerary/google-places.ts`, `lib/itinerary/ensure-meals.ts`, `lib/itinerary/fill-sparse.ts`, `lib/itinerary/meal-slots.ts`, `lib/itinerary/meal-locations.ts`, `lib/itinerary/generate-diagnostics.ts`.

### Google quota finding (controlled Generate logs)

Server logs showed repeated Google Places **`OVER_QUERY_LIMIT`** from meal searches during and after Generate, including contexts such as:

- `searchMealPlaces: breakfast — breakfast Barcelona`
- `searchMealPlaces: lunch — lunch Barcelona`
- `searchMealPlaces: dinner — dinner Barcelona`

**Problem (pre–Phase B′):** `fillSparseDaysForTrip` and `ensureTripMeals` **kept attempting live meal recovery** after quota was already exhausted on the initial Generate fetch — multiplying failed Places calls without improving the itinerary. **Fixed in Phase B′** — see §8 persistent pool progress.

**Final diagnostic observed:**

```
[itinerary-generate] missing_meals_after_generation
  dayCount: 8
  incompleteDayCount: 5
```

**Product gap (pre–quality gate):** API returned **HTTP 200** and replaced the existing itinerary even when most days lacked core meals/density. **Fixed for replacement** — see quality gate section below. First-time Generate on an empty trip can still persist borderline results with warnings.

### Persistent candidate pools — architecture (target state)

**Generate now reads from `destination_place_candidates` first (Phases C–C.3.2).** Live Google tops up only shortfalls. **`fill-sparse`** and **`ensure-meals`** are pool-first (Phase C.2). Phases D+ extend pool-first to regenerate and refresh-suggestion.

| Principle | Intent |
|-----------|--------|
| **Google discovers inventory** | Use Places to build and refresh candidate inventory, not to schedule every stop on every run |
| **Voyage generates from saved inventory** | Generate + post-passes read global pool first (Phase C ✓, C.2 ✓); regenerate / refresh-suggestion pool-first — Phase D/E (future) |
| **Destination-level pool** | One Generate for a destination **creates or tops up** reusable pool rows (Phase B write-through) |
| **Cross-trip reuse** | Users/trips to the same destination reuse the pool (Phase C ✓) |
| **Stored-data-first hydration** | Trip places use DB + pool before live Details during Generate (Phase C.3 ✓, C.3.1 ✓, C.3.2 ✓) |
| **Periodic refresh** | Refresh stale metadata on a schedule (e.g. ~2 weeks) — Phase F (future) |
| **Regenerate / refresh-suggestion** | Trip deck → global pool → live Google fallback — Phases D/E (future) |
| **Durable keys** | Store **`google_place_id`** as the stable key |
| **No raw photo hoarding** | Global pool stores no photo URLs or raw photo bytes; no photo backfill during Generate |
| **Quality gates** | Severely incomplete results **do not replace** an existing itinerary (commit `058a44d` ✓); first-time Generate may still persist with warnings |

**Table roles:**

| Table | Role |
|-------|------|
| **`places`** | Trip-scoped / user-specific saved venues (manual My Places + suggested stop backing rows). **Not** shared inventory. |
| **`destination_place_candidates`** | Shared destination-level candidate inventory (keyed by `google_place_id` per destination). |
| **`trip_candidate_pool`** | Per-trip scheduler deck and placement state (Phase D+; schema exists, not wired yet). |

See **`COST_SAFETY_CHECKPOINT.md`** for env flags and cost controls.

---

### Current state — pool-first / quota-safe Generate + quality gate + density repair (Phases B′ through C.3.2 + replacement gate + density repair) ✓ validated

**Where we are:** The cost-safe / pool-first Generate foundation is **validated** on the Barcelona test trip. Generate is **saved-inventory-first** end-to-end when the global pool is populated. Live Google is a **fallback only**, gated per request. Pre- and post-generate hydration no longer waste quota on schedule-usable places. A **quality gate** prevents materially incomplete generated itineraries from **replacing** a better existing plan. A **density repair pass** now improves low-sightseeing days from saved pool candidates **before** the quality gate evaluates the result.

| Layer | Status | Key behavior |
|-------|--------|--------------|
| **Quota gate (B′)** | ✓ | Request-scoped; skips live Places after exhaustion |
| **Schema + write-through (A/B)** | ✓ | `destination_place_candidates` populated; Barcelona pool = 135 active |
| **Main Generate (C/C.1)** | ✓ | Reads global pool; restaurant meal fallback; zero live top-up when pool sufficient |
| **Post-passes (C.2)** | ✓ | `fill-sparse` + `ensure-meals` read destination pool before live Google |
| **Pre-generate hydration (C.3 / C.3.1)** | ✓ | Stored DB → pool → live Details last resort; schedule-usable places skip live details |
| **Post-generate hydration (C.3.2)** | ✓ | Same stored/pool-first path after fill-sparse / ensure-meals; no photo burst |
| **Visible category display** | ✓ | Itinerary stops map to trip-setup interest categories (see below) |
| **Quality gate (replacement)** | ✓ | Blocks wipe when generated result is materially incomplete vs existing itinerary |
| **Density repair (low sightseeing)** | ✓ | Pre–quality-gate repair from saved in-memory pools; no live Google |
| **Trip deck (D)** | Not wired | `trip_candidate_pool` schema only |
| **refresh-suggestion** | Not pool-first | Still live Google |

**Barcelona controlled Generate validation (latest — post density repair):**

Pre-start hydration:

```
[itinerary-generate] stored_place_hydration
  liveDetailsAttempted: 0
  skippedQuota: 0
  scheduleUsableWithoutHours: 14
```

Main Generate (pool-first):

```
[candidate-pool] pool_generate_inputs
  fromGlobalPool: true
[candidate-pool] google_top_up
  googleFetchedCounts: { interest: 0, restaurant: 0, parks: 0, experiences: 0, meals: 0 }
```

Post-generate hydration:

```
[itinerary-generate] post_generate_place_hydration
  liveDetailsAttempted: 0
  skippedQuota: 0
```

**Confirmed:**

- **No `fetchPlaceDetails` quota exhaustion** during pre-start or post-generate hydration.
- Post-passes used saved pool (`[fill-sparse] pool_candidates_used`, `[ensure-meals] pool_candidates_used`).
- Final missing meals only included the **intentional Day 4 Montserrat excursion breakfast skip**.
- **Density repair** fixed Day 3 and Day 5 from sightseeing 1 → 2 using saved pool only (`daysRepaired: 2`, `totalAdded: 2`).
- **Quality gate** after repair: `severity: 'ok'`, `lowSightseeingDays: 0`, `generatedStopCount: 53`.

**Remaining itinerary-quality issues (next work area — not quota/architecture):**

- Late-day meal placement can still fail when:
  - cursor is past the meal window
  - too many restaurant candidates are already used
  - meal overlap / reschedule constraints block placement
- Day 4 breakfast skip is **intentional** when the early Montserrat excursion prevents breakfast or late brunch placement.
- Current quality work should focus on:
  1. **Improve late-day meal placement**
  2. **Phase D trip candidate deck** (`trip_candidate_pool`)

**Recommended next step:** **Late-day meal placement**, then **Phase D trip deck** — not another cost-safety validation Generate unless regressions are suspected.

---

### Phase B′ — request-scoped Places quota gate (commit `23af94a`)

**Key file:** `lib/itinerary/places-quota-gate.ts`

- **Request-scoped** `PlacesQuotaGate` — one instance per Generate request; no global cross-user blocking.
- When Google returns **`OVER_QUERY_LIMIT`** or **`RESOURCE_EXHAUSTED`**, the gate marks quota exhausted for the remainder of that request.
- **Later live Places calls in the same request are skipped** — empty/null results, no retries, no Directions calls.
- Prevents **`fill-sparse`** and **`ensure-meals`** from repeatedly calling breakfast/lunch/dinner searches after quota was already exhausted on the initial Generate fetch.
- Wired through `lib/itinerary/google-places.ts`, `app/api/itinerary/generate/route.ts`, `fill-sparse.ts`, `ensure-meals.ts`, `enrich-places.ts`.
- **Raw Google error messages are not exposed to the UI.** Friendly quota copy via `QUOTA_EXHAUSTED_USER_MESSAGE` / `buildGenerateWarning` when materially incomplete.
- **Server logs:** `[itinerary-generate] quota_exhausted`, `quota_skip`, `quota_gate_summary`.

---

### Phase A — candidate pool schema and types (commit `68a360b`)

**Migration:** `supabase/migrations/008_candidate_pools.sql` — **applied successfully** in Supabase SQL Editor.

**TypeScript:** `lib/types.ts` — `Destination`, `DestinationPlaceCandidate`, `TripCandidatePoolEntry`, `CandidateGlobalStatus`, `TripCandidateStatus`, `CandidateRejectionReason`, `PoolTag`.

**New tables:**

- **`destinations`** — shared destination registry (`slug`, city, country, center coords, optional destination `google_place_id`).
- **`destination_place_candidates`** — global shared inventory (no photo columns).
- **`trip_candidate_pool`** — per-trip candidate deck/state (not wired to scheduler yet).

**New enums:**

- `candidate_global_status` — `active`, `retired`, `pending_refresh`
- `trip_candidate_status` — `available`, `placed`, `rejected`, `removed_by_user`, `reserved`
- `candidate_rejection_reason` — `opening_hours`, `proximity`, `duplicate_brand`, `duplicate_day`, `scheduler_failed`, `user_dismissed`, `low_quality`

**RLS:**

- **`destinations`** and **`destination_place_candidates`** — RLS enabled, **no client policies** (server-controlled via service role for pool population).
- **`trip_candidate_pool`** — trip-owner CRUD + public read via shared trip (matches `places` / `hotels` pattern).

---

### Service role key (local dev)

- **`SUPABASE_SERVICE_ROLE_KEY`** added locally to **`.env.local`** for global pool read/write-through.
- **`.env.local` must never be committed.**
- **`.env.example`** documents the variable.
- **`lib/supabase/service.ts`** — `createServiceRoleClient()` bypasses RLS for server-side reads/writes to global pool tables.

---

### Phase C — read destination pool before Google top-up (completed)

**Commit:** *Read destination candidate pool before Google top-up*

**Key files:**

- `app/api/itinerary/generate/route.ts` — pool-first orchestration, conditional live top-up, write-through of Google results only
- `lib/itinerary/candidate-pool.ts` — `resolveDestinationForTrip`, `loadDestinationCandidates`, `loadGenerateCandidatePoolsFromDestinationPool`, shortfall thresholds, merge helpers
- `lib/itinerary/google-places.ts` — exported `searchMealPlaces` for per-meal top-up

**Behavior:**

- Generate **reads from `destination_place_candidates` first** for the trip destination (normalized slug, e.g. `barcelona|spain`).
- Active global candidates are **mapped back** into scheduler-compatible `PlaceSearchResult` shapes (no photo URLs).
- **Manual places** and **itinerary stop Google IDs** remain excluded via existing `getSuggestionExcludeGoogleIds`.
- **Live Google Places** is called **only to top up** categories/tags below conservative trip-length thresholds:
  - meals (B/L/D): `tripDayCount + 2` each
  - restaurant general: `tripDayCount × 2`
  - activity/sightseeing: `tripDayCount × 4`
  - parks/nature: `⌈tripDayCount / 2⌉` when `parks` interest selected
  - experiences: `⌈tripDayCount / 2⌉` when `activities` interest selected
- Combined pools (global first, live Google second) are passed to **`generateSmartItinerary`** — scheduler logic **mostly unchanged**.
- Live Google results still **write through** to global pool (Phase B); quota-skipped fetches write nothing.
- **`trip_candidate_pool` is not wired yet.**
- **`refresh-suggestion`** is **not** pool-first yet.
- **`fill-sparse`** and **`ensure-meals`** are pool-first as of **Phase C.2** (see below).

**Controlled test confirmed:**

- `fromGlobalPool: true`
- `googleFetchedCounts: { interest: 0, restaurant: 0, parks: 0, experiences: 0, meals: 0 }`

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[candidate-pool] pool_read` | Destination slug, candidates loaded, counts by tag/category |
| `[candidate-pool] pool_shortfall` | Categories below threshold (post-fallback after Phase C.1) |
| `[candidate-pool] google_top_up` | Top-up attempted/skipped/sufficient; quota skips |
| `[candidate-pool] pool_generate_inputs` | Final pool sizes; `fromGlobalPool: true/false` |

---

### First Barcelona pool test (Phase B + C)

First controlled Generate after Phase B/C write-through **populated the Barcelona global pool**. Supabase confirmed:

| Field | Value |
|-------|-------|
| Destination slug | `barcelona\|spain` |
| Total candidates | **135** |
| Active | **135** |

**Tag counts confirmed:**

| Tag / category | Count |
|----------------|-------|
| Total | 135 |
| breakfast | 8 |
| lunch | 8 |
| dinner | 8 |
| restaurants | 39 |
| parks | 37 |
| experiences | 43 |

This pool is now available for subsequent Generate runs to read before live Google.

---

### Quota gate confirmed working (same Barcelona Generate test)

During the same controlled Generate test, Google Places quota was eventually exhausted at:

- `fetchExperiencesPool: walking tour Barcelona`

The **Phase B′ quota gate** then skipped later live calls in that request. Logs showed:

- `[itinerary-generate] quota_exhausted`
- `[itinerary-generate] quota_skip`
- `[itinerary-generate] quota_gate_summary`

**25 additional live calls** were skipped in that request, including repeated details/experience/restaurant fallback calls. This confirms Phase B′ prevents repeated wasted Places calls after quota exhaustion within a single Generate request.

---

### Phase C.1 — restaurant pool supplements meal pools (completed)

**Commit:** *Use restaurant pool to supplement meal candidates*

**Problem fixed:** Barcelona had **8 breakfast / 8 lunch / 8 dinner** tagged candidates but **39 general restaurants**. For an **8-day trip**, Phase C thresholds want **10 per meal type** — Phase C alone would still trigger live Google meal top-ups despite ample saved restaurants.

**Behavior:**

- **General saved restaurant candidates** now supplement breakfast/lunch/dinner pools **before** any Google meal top-up.
- **Meal-tagged candidates preferred first**; general restaurants fill only to meet candidate-count thresholds.
- Example: breakfast-tagged = 8, threshold = 10, restaurant pool = 39 → **+2 general restaurants** added to breakfast pool → **no Google breakfast top-up**.
- Exact **`google_place_id` dedupe** within each meal pool; global candidates remain before live Google in merge order.
- **No new Google calls added.** Scheduler unchanged. **`trip_candidate_pool` remains unwired.** No Directions calls.

**Eligibility for restaurant meal fallback:**

- `pool_tags` contains `restaurant`, OR `primary_category = restaurant`, OR `is_sit_down_restaurant`
- Active, not permanently closed, not in manual/itinerary exclusion list
- Prefer `is_sit_down_restaurant`; rating ≥ 3.0 when rating present (not required when absent)
- Does **not** require existing breakfast/lunch/dinner tag

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[candidate-pool] restaurant_meal_fallback` | Per meal: tagged count, fallback restaurants added, final pool count |
| `[candidate-pool] pool_shortfall` | Reflects **post-fallback** meal pool counts |
| `[candidate-pool] google_top_up` | Includes `skippedRestaurantFallback` when meal top-ups avoided via restaurant pool |

**Expected for Barcelona 8-day trip with current pool:** breakfast/lunch/dinner Google top-ups **should be skipped** (8 tagged + 2 restaurant fallback = 10 each).

---

### Phase C.2 — post-passes use destination pool (completed)

**Commit:** *Use destination pool in itinerary post-passes*

**Key files:**

- `lib/itinerary/fill-sparse.ts` — pool-first activity and meal top-up
- `lib/itinerary/ensure-meals.ts` — pool-first B/L/D insertion
- `lib/itinerary/candidate-pool.ts` — `loadPostPassDestinationPool`, `gatherMealCandidatesForPostPass`

**Behavior:**

- **`fillSparseDaysForTrip`** and **`ensureTripMeals`** load saved destination pool before live Google.
- Post-pass pools include: activity pool, restaurant pool, breakfast/lunch/dinner meal pools (with restaurant fallback from C.1).
- Live fallback only when saved pool has no usable candidates **and** quota gate allows.
- When quota exhausted, post-passes still use saved pool; live calls skipped (`live_fallback_skipped_pool_available`).
- **`trip_candidate_pool` not wired.**

**Controlled test confirmed:**

- `[candidate-pool] postpass_pool_read` — e.g. `restaurantPool: 65`, `breakfastMealPool/lunchMealPool/dinnerMealPool: ~65` each
- `[fill-sparse] pool_candidates_used`, `[ensure-meals] pool_candidates_used`
- Missing meals dropped to **only intentional excursion-day breakfast skip**
- No more repeated `fetchAlternativeSuggestion: restaurant` quota skips when saved restaurants exist

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[candidate-pool] postpass_pool_read` | Post-pass pool load counts |
| `[fill-sparse] pool_candidates_used` | Saved pool used for sparse-day repair |
| `[ensure-meals] pool_candidates_used` | Saved pool used for meal insertion |
| `[fill-sparse] live_fallback_skipped_pool_available` | Live Google skipped — pool or quota |
| `[ensure-meals] live_fallback_skipped_pool_available` | Live Google skipped — pool or quota |

---

### Phase C.3 — Generate place hydration stored-data-first (completed)

**Commit:** *Make generate place hydration stored-data first*

**Root cause found:**

- **`enrichPlacesInBackground`** was called **before** `[itinerary-generate] start` in the Generate route.
- It ran **`Promise.all`** across all trip places in parallel.
- Called **`fetchPlaceDetails`** for every place missing opening hours.
- Called **`resolvePlacePhoto`** → **`fetchPlaceByGoogleId`** for photo backfill.
- **Photos are not needed for scheduling** but consumed quota before main generation began.
- Logs showed `quota_exhausted { context: 'fetchPlaceDetails' }` before `[itinerary-generate] start`.

**Fix:**

- **Removed `enrichPlacesInBackground`** from the Generate route.
- Added **`hydratePlacesForGenerate`** (`lib/itinerary/enrich-places.ts`).
- Hydration order: **stored DB fields** → **`destination_place_candidates`** by `google_place_id` → live **`fetchPlaceDetails`** (quota-gated last resort).
- **No photo fetches** during Generate.
- **Sequential** hydration — no parallel burst, no retries.

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[itinerary-generate] stored_place_hydration` | `fromStoredDb`, `fromDestinationPool`, `liveDetailsAttempted`, `skippedQuota`, `missingCoordinates` |

---

### Phase C.3.1 — avoid live details for schedule-usable Generate places (completed)

**Commit:** *Avoid live details for schedule-usable generate places*

**Problem fixed:** Pre-start hydration still attempted live `fetchPlaceDetails` for places that already had enough stored data to schedule but were missing opening hours.

**Schedule-usable stored place** (during Generate):

- Has **name**
- Has **category/type**
- Has **coordinates** (from stored place row or destination pool fallback)
- **Opening hours may be missing**

**Behavior:**

- Generate **does not** call live `fetchPlaceDetails` just to fill opening hours for schedule-usable places.
- Missing opening hours remain unknown and are handled by existing scheduler **strict/relaxed** logic.
- Live details attempted only when the place is **not** schedule-usable and quota allows.

**Diagnostics:**

| Log | Field | Purpose |
|-----|-------|---------|
| `[itinerary-generate] stored_place_hydration` | `scheduleUsableWithoutHours` | Places skipped live details because stored data was sufficient |

**Barcelona validation:** `liveDetailsAttempted: 0`, `scheduleUsableWithoutHours: 14`.

---

### Phase C.3.2 — avoid live details in post-generate hydration (completed)

**Commit:** *Avoid live details in post-generate hydration*

**Problem fixed:** After `fill-sparse` / `ensure-meals`, post-generate `enrichPlacesOpeningHours` still hit live `fetchPlaceDetails` and could exhaust quota (`quota_exhausted { context: 'fetchPlaceDetails' }`) even when pre-start hydration was clean.

**Behavior:**

- Post-generate enrichment shares the **same stored/pool-first hydration path** as pre-generate (`hydratePlacesStoredFirst` in `lib/itinerary/enrich-places.ts`).
- After fill-sparse and ensure-meals, enrichment:
  1. Uses **stored DB fields** first
  2. Uses **destination pool rows** by `google_place_id` second
  3. **Skips live details** for schedule-usable places
  4. Attempts live details only if data is insufficient and quota allows
- **No photo backfill** during Generate.
- **No parallel details burst.** Sequential; no retries.

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[itinerary-generate] post_generate_place_hydration` | `fromStoredDb`, `fromDestinationPool`, `scheduleUsableWithoutHours`, `liveDetailsAttempted`, `skippedQuota`, `missingCoordinates` |

**Barcelona validation:** `post_generate_place_hydration.liveDetailsAttempted: 0`, `skippedQuota: 0`. No `fetchPlaceDetails` quota exhaustion during post-generate hydration.

---

### Visible category normalization (completed)

**Commit:** *Normalize itinerary category display*

**Problem fixed:**

- Food markets were showing as 🎤 **Activities**.
- Parks/outdoors were showing as 📍 **Monuments**.
- Itinerary stop display did not match the visible categories shown in the trip setup UI.

**Visible categories (aligned with trip interests):**

| Category | Label | Emoji |
|----------|-------|-------|
| shopping | Shopping | 🛍️ |
| restaurant | Restaurants | 🍽️ |
| bars_nightlife | Bars & Nightlife | 🍸 |
| activity | Activities | 🎤 |
| monument | Monuments | 📍 |
| museum | Museums | 🏛️ |
| food_market | Food Markets | 🥐 |
| parks_outdoors | Parks & Outdoors | 🌳 |

**Central helper:** `lib/itinerary/visible-category.ts`

| Function | Purpose |
|----------|---------|
| `resolveVisibleItineraryCategory()` | Normalizes from place name, stored category, Google types, pool tags |
| `getPlaceDisplayStyle()` / `getVisibleCategoryStyle()` | Labels, emojis, colors for UI |
| `googleTypesToPlaceCategory()` | Name-aware storage category (used by `googleTypeToCategory` in `lib/types.ts`) |
| `visibleCategoryToPoolTags()` | Consistent pool tag assignment in `pool-tags.ts` |

**Priority rules (specific categories win over generic fallbacks):**

- **Food market** before restaurant/activity — e.g. “La Boqueria”, “Mercat de Sant Josep” → 🥐 Food Markets
- **Parks/outdoors** before monument — e.g. “Park Güell”, “Ciutadella Park” → 🌳 Parks & Outdoors
- **Museum** → 🏛️ Museums
- **Bars/nightlife** → 🍸 Bars & Nightlife
- **Restaurant** → 🍽️ Restaurants
- **Shopping** → 🛍️ Shopping
- **Monument** only after market/park/museum/category checks → 📍 Monuments
- **Activity** fallback for experiences, tours, general things to do → 🎤 Activities

**Applied areas:**

- Plan itinerary stops (`itinerary-section.tsx`)
- Place detail sheet
- My Places
- Trip map pins (`TripMap.tsx`)
- Discover / search / autocomplete (name-aware category mapping — no new API calls)
- New generated candidates / pool tags (`pool-tags.ts`, `google-places.ts`, `smart-generate.ts`)

**Verification:**

- `npx tsc --noEmit` passed
- `npx tsx scripts/verify-visible-category.ts` passed **10/10** fixtures

Existing DB `places.category` values unchanged — display category derived in code at render time.

---

### Quality gate before replacing itinerary — completed

**Commit:** *Add quality gate before replacing itinerary* (`058a44d`)

**What it does:**

- Generate now **evaluates the newly generated itinerary** before deleting/replacing the existing itinerary.
- The quality gate runs **after in-memory generation** and the **zero-stop guard**, but **before any delete/persist**.
- If the generated result is **materially incomplete**, the **existing itinerary is preserved**.
- If the generated result is **acceptable but has minor issues**, it **persists with warnings**.

**Key files:**

- `app/api/itinerary/generate/route.ts` — orchestrates gate, loads existing stats, returns 409/422 on block
- `lib/itinerary/quality-gate.ts` — `evaluateItineraryQualityGate()` criteria and diagnostics
- `lib/itinerary/generate-diagnostics.ts` — `logQualityGate()` server log
- `components/trip/itinerary-section.tsx` — 409 handling, friendly toast when current plan kept

**Blocking conditions** (severity `block` — do not delete/replace when an existing itinerary would be wiped):

| Condition | Detail |
|-----------|--------|
| Zero generated days or stops | Empty in-memory result (zero stops also caught earlier with 503) |
| Too few total stops for trip length | e.g. fewer than `tripDayCount × 4` for multi-day trips |
| Too many sparse days | ≥ ~45% of days with fewer than 4 stops |
| Too many required meals missing | ≥ ~60% of days with significant missing meals (excursion breakfast skips excluded) |
| Too many days missing lunch/dinner | ≥ ~40% missing both; ≥ ~55% missing lunch or dinner on 3+ day trips |
| Severe day imbalance | e.g. nearly empty days alongside well-populated days |
| Materially worse than existing | New stop count below ~65% of existing |
| Major meal regression vs existing | Existing was mostly complete; new result has many more incomplete meal days |

**Warnings that do not block** (severity `warning` — persist as usual, return 200 with `warning`):

- One **tolerated excursion-day breakfast skip** (e.g. Montserrat Day 4)
- One **isolated low-sightseeing** warning when the overall itinerary is healthy
- **Minor meal warnings** below block threshold
- **Somewhat fewer stops** than existing, as long as above the severe regression threshold (~65%)

**API / UI behavior:**

| Outcome | API | DB | UI |
|---------|-----|----|----|
| **Blocked** (existing itinerary) | **409** + `qualityGate` diagnostics | Existing rows **not deleted** | Does **not** show “Itinerary ready!”; toast: **“We kept your current plan”** |
| **Blocked** (no existing itinerary) | **422** + `qualityGate` diagnostics | Nothing persisted | Error toast with friendly message |
| **Warning only** | **200** + `warning` (+ optional `qualityGate`) | Persists as usual | “Itinerary ready!” with warning description if present |
| **OK** | **200** | Persists as usual | “Itinerary ready!” |

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[itinerary-generate] quality_gate` | Severity, `shouldBlockReplacement`, reasons, generated/existing day and stop counts, missing meal count, low-density days, low-sightseeing days, severe imbalance |

**Cost safety (unchanged):**

- **No new Google Places calls**, Directions calls, retries, or photo fetching
- **No migrations** or **`trip_candidate_pool`** wiring

**Verification:** `npx tsc --noEmit` passed.

---

### Density repair / low-sightseeing recovery — completed

**Commit:** *Repair low sightseeing days before quality gate*

**What it does:**

- Adds a **pre–quality-gate repair pass** that improves days with too few sightseeing/activity stops.
- Runs **after** `generateSmartItinerary()` and **before** the quality gate / persistence.
- Uses **saved in-memory/pool candidates only**.
- Does **not** call Google Places.
- Does **not** call Directions.
- Does **not** wire **`trip_candidate_pool`**.

**New file:**

- `lib/itinerary/density-repair.ts`

**Updated files:**

- `app/api/itinerary/generate/route.ts`
- `lib/itinerary/generate-diagnostics.ts`
- `lib/itinerary/smart-generate.ts`

**Why it was needed:**

- Some days had enough **total stops** but still only **one sightseeing/activity stop**.
- **`topUpSparseDay`** previously cared mostly about total stop count, so a day with meals + one activity + nightlife could still pass density but log `low_sightseeing:1`.
- Activity top-up could **give up too early** after a failed candidate.

**Behavior:**

- Targets **at least 2 sightseeing/activity-type stops** for normal non-excursion days when feasible.
- Merges saved candidates from:
  - `interestPool`
  - `parksPool`
  - `experiencesPool`
- Dedupes by **`google_place_id`**.
- Filters out used IDs, same-day duplicates, manual places, non-sightseeing categories, post-dinner non-nightlife, and theme duplicates.
- Respects fixed anchors, reservations, rest blocks, and meal rhythm.
- Recomputes schedule times after insertion.
- Skips **excursion days** (Montserrat-style days).

**Caps / safeguards:**

| Cap | Value |
|-----|-------|
| Target sightseeing count | 2 |
| Max candidates tried per slot | 25 |
| Max stops added per day | 2 |
| Max total repair attempts per Generate | 50 |

- **No retries** or live Google fallbacks.

**Diagnostics:**

| Log | Purpose |
|-----|---------|
| `[itinerary-generate] density_repair_start` | Day repair started; starting/target sightseeing, pool size |
| `[itinerary-generate] density_repair_added` | Saved-pool stop inserted |
| `[itinerary-generate] density_repair_skipped` | Day skipped (e.g. excursion) |
| `[itinerary-generate] density_repair_summary` | Per-day or trip-level outcome, skip counts, final sightseeing |

**Latest validation (Barcelona test trip):**

- Day 3 repaired from sightseeing **1 → 2**.
- Day 5 repaired from sightseeing **1 → 2**.
- Trip-level repair summary:
  - `daysConsidered: 2`
  - `daysRepaired: 2`
  - `totalAdded: 2`
- Quality gate returned:
  - `severity: 'ok'`
  - `shouldBlockReplacement: false`
  - `generatedStopCount: 53`
  - `lowSightseeingDays: 0`
  - `missingMealCount: 0`
- Pre/post hydration still showed **`liveDetailsAttempted: 0`**.
- Main Generate still used destination pool with **`googleFetchedCounts` all 0**.

**Cost safety (unchanged):**

- **No new Google Places calls**, Directions calls, retries, or photo fetching
- **No migrations** or **`trip_candidate_pool`** wiring
- **No new live Google calls** for density repair — saved pools only

**Verification:** `npx tsc --noEmit` passed.

**Current next recommended work:**

1. **Improve late-day meal placement** / cursor-past-window failures.
2. Then **Phase D trip candidate deck** (`trip_candidate_pool`).
3. **Keep quality gate in place** as protection against replacing a good existing itinerary.

**Cost safety reminders:**

- Do not repeatedly click Generate.
- No Directions API calls.
- No page-load Places calls.
- No photo backfill during Generate.
- No new live Google calls for density repair.
- Never commit `.env.local` or `SUPABASE_SERVICE_ROLE_KEY`.

---

### Next planned phase options

**Option A — Quality gate before replacing itinerary** ✓ **completed** (commit `058a44d`)

**Option B — Improve day density / low sightseeing** ✓ **completed** (*Repair low sightseeing days before quality gate*)

- Pre–quality-gate repair pass from saved pool candidates.
- `topUpSparseDay` also improved: targets sightseeing &lt; 2, pre-dinner deadline, allows consecutive failures before stopping.

**Option C — Improve late-day meal placement** *(recommended next)*

- Make lunch/dinner placement more resilient when cursor is late.
- Avoid cursor-past-window failures when reasonable meal slots still exist.
- Better handle candidate exhaustion from `usedGoogleIds` / `duplicateBrand` rules.

**Option D — Phase D: trip candidate deck** *(after C)*

- Wire **`trip_candidate_pool`**.
- Snapshot candidates per trip.
- Track available / placed / rejected / removed_by_user.
- Regenerate from unused trip-specific candidates first.
- Refresh-suggestion from unused trip candidates first.

**Still later (not immediate):**

- **Phase E** — refresh-suggestion pool-first
- **Phase F** — scheduled pool refresh (~2 weeks)
- Optional home base, neighborhood/day clustering

---

### Phase B — write-through caching (commit `f3e0af5`)

Google results fetched during Generate are **passively cached** into destination candidate tables after fetch, before in-memory scheduling.

**New files:**

- `lib/itinerary/candidate-pool.ts` — destination upsert, candidate upsert, `writeThroughGenerateCandidatePools`
- `lib/itinerary/pool-tags.ts` — tag/category mapping, quality score, in-batch merge
- `lib/supabase/service.ts` — service-role Supabase client

**Updated:** `app/api/itinerary/generate/route.ts` — calls `writeThroughGenerateCandidatePools` after pool fetches.

**Behavior (unchanged for scheduling):**

- Generate **still uses the same in-memory pools** passed to `generateSmartItinerary`.
- **`smart-generate`** and **`refresh-suggestion`** do **not** read from persistent pool yet.
- **`fill-sparse`** / **`ensure-meals`** are pool-first as of Phase C.2.
- Cache write failures are **non-blocking** — log `[candidate-pool] upsert_failed` and continue Generate.
- **No extra Google calls** added; quota-skipped fetches produce nothing to cache.
- **No photo URLs or raw photos** stored in global pool.

**Write-through sources:**

- Interest/activity pool → `interest_search`
- Restaurant pool → `restaurant_pool`
- Parks/nature pool → `parks_pool`
- Experiences pool → `experiences_pool`
- Meal prefetch map → `meal_search`

**Tags (`pool-tags.ts`):**

- Meal searches → `breakfast` / `lunch` / `dinner` + `restaurant` when sit-down
- Restaurant pool → `restaurant`
- Parks → `park_nature`
- Experiences → `experience`
- Interests → relevant pool tags via `candidateMatchesInterest`
- Duplicates within one Generate or across DB rows → **merge tags** (union), do not drop useful tags

**Diagnostics:** `[candidate-pool] destination_upserted`, `candidates_upserted` (counts by source/tag), `upsert_failed`.

---

## 9. Google / photo / details — current state

| Area | Behavior |
|------|----------|
| Place photos | Proxied via `/api/places/photo` when enabled; emoji/gradient fallbacks when `DISABLE_*_PHOTO_PROXY` flags are true |
| Trip covers | Gated; backfill skipped on `/trips` load when disabled |
| Place detail sheet | Merges stored Supabase data + `/api/places/details`; stored-only when photo/quota flags on |
| Google Maps links | Outbound only — client-built URLs, no app API call |
| Plan thumbnails | Proxy or emoji fallback per client flag |
| **Discover tab** | User-initiated `/api/places/search`; category mapping is name-aware; **still renders direct `photoUrl` `<img>`** — not yet gated like Plan/trip cards. Future cleanup item. |
| **Itinerary category display** | Stops use `getPlaceDisplayStyle()` from `lib/itinerary/visible-category.ts` — 8 visible categories aligned with trip setup interests |
| **Maps JavaScript** | TripMap + hotel explore load Maps JS; may show **`OverQuotaMapError`** if Maps quota exhausted (separate from Places mock modes) |

---

## 10. Known limitations / future to-do

### Active — itinerary builder

- **Day density / low sightseeing** ✓ — pre–quality-gate density repair from saved pools; Day 3 and Day 5 validated 1 → 2 sightseeing. See §8 density repair section.
- **Late-day meal placement (recommended next)** — cursor-past-window and candidate exhaustion gaps. See §8 Option C.
- **Quality gate before replacement** ✓ — commit `058a44d`; severely incomplete results no longer wipe an existing itinerary. See §8 quality gate section.
- **Pool-first Generate validated** — Barcelona controlled Generate confirmed zero live details hydration, zero Google top-up when pool sufficient, intentional Day 4 breakfast skip only, density repair + quality gate OK. See §8 current state.
- **Visible category display fixed** — food markets, parks, and other stops map to trip-setup interest categories via `lib/itinerary/visible-category.ts`.
- **Day rhythm / density not fully guaranteed during initial scheduling** — density repair + quality gate improve outcomes; severe replacement regressions still blocked.
- **Trip deck / regenerate / refresh from saved candidates** — Phase D (after late-day meal work); `trip_candidate_pool` schema exists but is not wired.
- **refresh-suggestion** — not pool-first yet.
- **Optional home base** — Generate currently requires a saved hotel; future phase.
- **Neighborhood / day clustering** — future phase.

### General

- **Maps JavaScript `OverQuotaMapError`** — visual maps may fail when Maps quota is exhausted even if Places mock modes are on; raise Maps quota cautiously for map testing only.
- **Lazy-load Maps JavaScript** — reduce automatic map load cost (TripMap + hotel explore both load Maps JS).
- **Live hotel pricing** — requires real provider/booking API before nightly filters (see §7).
- **Discover photos** — should respect photo-disable/proxy behavior (currently direct Google photo URLs in UI).
- **Caching / rate limiting** — Phase B write-through populates global pool; Phases C–C.3 read it first on Generate and post-passes. Consider rate limits on autocomplete/search routes.
- **DB-level unique trip-name index** — after cleaning any existing duplicate names per user.
- **Dev banner** — surface when cost-safety or mock flags are active.
- **Directions routes** — dormant API routes still exist; consider hard-gating or removal.
- **Fill sparse days** — consider explicit “Fill sparse days” button instead of hidden `explicit: true` flow.

---

## 11. Developer workflow reminders

1. Read `COST_SAFETY_CHECKPOINT.md` before Google work.
2. Apply migrations if needed: `007_trip_destination_coords.sql` (trip coords), **`008_candidate_pools.sql`** (persistent pool tables — applied in Supabase SQL Editor).
3. `git status --short` before and after edits.
4. **Do not commit or push** until Ava reviews (unless explicitly asked).
5. Small commits by feature; complete sentences in commit messages.
6. When quota is exhausted: enable cost flags + mock modes (`NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE`, `NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE`).
7. **Never commit `.env.local`.** Includes `SUPABASE_SERVICE_ROLE_KEY` for pool read/write-through (present locally for dev).
8. Restart `npm run dev` after changing `NEXT_PUBLIC_*` env vars.
9. **Do not repeatedly click Generate** — one controlled test at a time; Generate can still call live Places for true shortfalls only.
10. **No Google Directions API** — Plan travel times use local estimates only (`lib/itinerary/travel.ts`). Directions remain local estimates only.
11. **No automatic Places calls on page load** — pool refresh must be scheduled/admin-controlled later, not page-load based.
12. **No photo backfill during Generate** — scheduling does not need photos; do not re-add `enrichPlacesInBackground` to the Generate route.
13. **No new live Google calls for density repair** — low-sightseeing recovery uses saved in-memory pools only.
14. **Never commit `.env.local` or `SUPABASE_SERVICE_ROLE_KEY`.**

---

## Quick file map

```
app/trips/new/page.tsx                  — Create Trip form, destination autocomplete, dates, duplicate check
app/trips/page.tsx                      — My Trips list
components/trip/trip-card.tsx           — Trip card UI
components/trip/trip-delete-dialog.tsx  — Delete confirmation
lib/trips/trip-name.ts                  — Duplicate name normalization/check
lib/maps/parse-destination.ts           — City/country from autocomplete result
lib/maps/mock-destination-autocomplete.ts — Mock Create Trip destinations
components/map/TripMap.tsx                — My Map centering + fit-bounds
lib/map/fit-bounds.ts                     — Map bounds incl. destination center
supabase/migrations/007_trip_destination_coords.sql — destination_lat/lng columns
supabase/migrations/008_candidate_pools.sql     — destinations, destination_place_candidates, trip_candidate_pool
lib/itinerary/places-quota-gate.ts              — request-scoped Places quota gate (Phase B′)
lib/itinerary/candidate-pool.ts                 — global pool read/write, post-pass pools, meal fallback (Phase B/C)
lib/itinerary/enrich-places.ts                  — stored-data-first hydration (Phase C.3 / C.3.1 / C.3.2)
lib/itinerary/visible-category.ts               — visible itinerary category normalization
lib/itinerary/pool-tags.ts                      — pool tag mapping for cached candidates
lib/supabase/service.ts                         — service-role client for global pool reads/writes
scripts/verify-visible-category.ts              — visible category fixture checks (10 examples)
components/trip/hotel-section.tsx       — Hotel tab states, explore entry, save, trip-date defaults
components/trip/hotel-explore-panel.tsx — Explore list/map, filters, pins
components/trip/trip-dashboard.tsx      — Trip props, hides side map during hotel explore
lib/maps/hotel-explore.ts               — Types, query helpers, client-side filters
lib/maps/mock-hotel-explore.ts          — Destination-aware mock hotels + friendly errors
lib/maps/google-maps-link.ts            — Outbound Maps URLs
app/api/places/autocomplete/route.ts    — Lodging + destination text search (user-initiated)
app/api/itinerary/generate/route.ts     — Generate orchestration, pool-first fetch, density repair, quality gate, post-passes
app/api/itinerary/add-rest/route.ts     — Rest block insert + reschedule
lib/itinerary/smart-generate.ts         — Day scheduler (meals, activities, manual places)
lib/itinerary/density-repair.ts         — Pre–quality-gate low-sightseeing repair from saved pools
lib/itinerary/quality-gate.ts           — Quality gate before replacing existing itinerary (commit 058a44d)
lib/itinerary/generate-diagnostics.ts   — Generate pool/day/quality-gate server logs
lib/itinerary/reschedule-day.ts         — Time chaining, rest intervals, chronological sort_order
lib/itinerary/apply-reschedule.ts       — Per-day / trip-wide reschedule DB updates
lib/itinerary/fill-sparse.ts            — Sparse-day top-up; pool-first (Phase C.2)
lib/itinerary/ensure-meals.ts           — Last-resort B/L/D insertion; pool-first (Phase C.2)
lib/itinerary/meal-slots.ts             — Meal insertion bounds, dedup rules
lib/itinerary/meal-locations.ts         — Meal search location, excursion helpers
components/trip/itinerary-section.tsx   — Plan UI, Generate handler, quality-gate 409 toast, meal warning toast
COST_SAFETY_CHECKPOINT.md               — Cost controls (authoritative)
.env.example                            — Flag documentation
```
