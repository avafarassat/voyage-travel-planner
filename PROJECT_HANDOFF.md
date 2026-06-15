# Voyage — project handoff

**Last updated:** 2026-06-15 (persistent candidate pools: Phase B′ quota gate, Phase A schema, Phase B write-through; next: Phase C read global pool first)  
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
| **Verify script** | `node scripts/verify-handoff.mjs` (reads `.env.local`) |

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
f3e0af5 Cache generated Places candidates
68a360b Add candidate pool schema and types
23af94a Add request-scoped Places quota gate
293e420 Avoid prematurely exhausting itinerary candidates
b6f28e4 Order rescheduled itinerary stops chronologically
3945efc Preserve stops when adding rest blocks and reschedule around them
b4699b5 Default hotel dates to trip dates
d9035f3 Make mock hotel explore destination aware
1375dc5 Gate automatic fill sparse for cost safety
260009a Document Google cost safety checkpoint
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
- **Generate still fetches live Places** for scheduling (Phase C will read saved pool first). **Quota gate (Phase B′):** once `OVER_QUERY_LIMIT` or `RESOURCE_EXHAUSTED` is detected in a Generate request, later live Places calls in that same request are skipped — including `fill-sparse` and `ensure-meals` meal searches.
- **Pool refresh (future)** must be **explicit, scheduled, or admin-controlled** — not uncontrolled per page load or per Plan mount.
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only; required for global candidate pool write-through (see §8). Documented in `.env.example`. **Never commit `.env.local`.**

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

**Key files:** `components/trip/itinerary-section.tsx`, `app/api/itinerary/generate/route.ts`, `lib/itinerary/smart-generate.ts`, `lib/itinerary/google-places.ts`, `lib/itinerary/places-quota-gate.ts`, `lib/itinerary/candidate-pool.ts`, `lib/itinerary/pool-tags.ts`, `lib/supabase/service.ts`, `lib/itinerary/reschedule-day.ts`, `lib/itinerary/apply-reschedule.ts`, `lib/itinerary/fill-sparse.ts`, `lib/itinerary/ensure-meals.ts`, `lib/itinerary/generate-diagnostics.ts`

### Core Plan behavior

- **Collapsible days** — Day 1 expanded by default; others collapsed (not persisted).
- **Travel times** — local estimates (`Est. walk` / `drive` / `transit`) via `estimateDisplayTravelLegs` in `lib/itinerary/travel.ts`. **No Directions API** from Plan UI.
- **Auto fill-sparse** gated by env flags — Plan mount does not POST `fill-sparse-days` when `NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true`. Note: **Generate** still calls `fillSparseDaysForTrip` directly server-side (not gated by that flag).
- **Generate** is explicit button action only; still heavy — do not run casually or repeatedly.
- **Generate safety guard (2026-06-15)** — protects users when Places quota is exhausted or Google returns empty candidate pools:
  - Generate **fails safely** when zero stops are produced.
  - `POST /api/itinerary/generate` returns a **friendly non-200** (503) if `stopCount === 0`, with a user-facing message about Places being unavailable or over quota.
  - **Existing itinerary rows are preserved** — delete/replace only runs after generated `stopCount > 0` is confirmed.
  - On success, response includes `{ success: true, dayCount, stopCount, warning? }`. Optional **`warning`** describes missing meals on one or more days (non-blocking).
  - UI shows **“Itinerary ready!”** when `stopCount > 0`; meal **`warning`** may appear as toast description. **This can look successful even when day quality is too low** (sparse stops, missing lunch/dinner, weak activity density) — quality gates are not yet enforced.
  - Quota/empty failures show the server error or a client fallback message instead.
  - Google Places **non-OK statuses** are logged server-side in `lib/itinerary/google-places.ts` (status, optional `error_message`, query context — no API keys).
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
| Misleading success UX | API can return **200** + “Itinerary ready!” when day quality is too low; meal `warning` is easy to miss and does not cover low activity density |

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

**Product gap:** API still returned **HTTP 200** for a severely incomplete itinerary. Quality gates (non-success or strong warning when most days lack core meals/density) are **not yet implemented**.

### Persistent candidate pools — architecture (target state)

**Generate still schedules from in-memory Google fetch results today.** Phases A/B/B′ lay foundation and passive caching; **Phase C** will read saved inventory before live Google.

| Principle | Intent |
|-----------|--------|
| **Google discovers inventory** | Use Places to build and refresh candidate inventory, not to schedule every stop on every run |
| **Voyage generates from saved inventory** | Generate, regenerate, fill-sparse, refresh-suggestion should prefer stored candidates (Phase C+) |
| **Destination-level pool** | One Generate for a destination **creates or tops up** reusable pool rows (Phase B write-through) |
| **Cross-trip reuse** | Future users/trips to the same destination reuse the pool (Phase C+) |
| **Periodic refresh** | Refresh stale metadata on a schedule (e.g. ~2 weeks) — Phase F (future) |
| **Regenerate / refresh-suggestion** | Trip deck → global pool → live Google fallback — Phases D/E (future) |
| **Durable keys** | Store **`google_place_id`** as the stable key |
| **No raw photo hoarding** | Global pool stores no photo URLs or raw photo bytes |
| **Quality gates** | Incomplete itineraries should not return normal success — future work |

**Table roles:**

| Table | Role |
|-------|------|
| **`places`** | Trip-scoped / user-specific saved venues (manual My Places + suggested stop backing rows). **Not** shared inventory. |
| **`destination_place_candidates`** | Shared destination-level candidate inventory (keyed by `google_place_id` per destination). |
| **`trip_candidate_pool`** | Per-trip scheduler deck and placement state (Phase D+; schema exists, not wired yet). |

See **`COST_SAFETY_CHECKPOINT.md`** for env flags and cost controls.

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

- **`SUPABASE_SERVICE_ROLE_KEY`** added locally to **`.env.local`** for global pool write-through.
- **`.env.local` must never be committed.**
- **`.env.example`** documents the variable.
- **`lib/supabase/service.ts`** — `createServiceRoleClient()` bypasses RLS for server-side writes to global pool tables only.

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
- **`smart-generate`**, **`fill-sparse`**, **`ensure-meals`**, **`refresh-suggestion`** do **not** read from persistent pool yet.
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

### Next planned phase — Phase C: read global pool first

**Goals:**

- Generate loads usable candidates from **`destination_place_candidates`** before live Google.
- Live Google **only tops up** categories/tags that are insufficient for the trip.
- Preserve **manual places** and **reservation anchors** (existing exclusion logic unchanged).
- **Do not wire `trip_candidate_pool` yet** unless explicitly doing Phase D.
- Maintain **cost safety** and **quota gate** — no retries, no Directions, test sparingly (**do not repeatedly click Generate**).
- Add diagnostics for pool-source counts:
  - global pool candidates used
  - Google top-up candidates fetched
  - categories/tags shortfalls

**Still later (not Phase C):**

- **Phase D** — trip-specific deck / regenerate from unused candidates
- **Phase E** — refresh-suggestion pool-first
- **Phase F** — scheduled pool refresh (~2 weeks)
- **Phase G** — quality gate before wiping existing itinerary
- Optional home base, neighborhood/day clustering

---

## 9. Google / photo / details — current state

| Area | Behavior |
|------|----------|
| Place photos | Proxied via `/api/places/photo` when enabled; emoji/gradient fallbacks when `DISABLE_*_PHOTO_PROXY` flags are true |
| Trip covers | Gated; backfill skipped on `/trips` load when disabled |
| Place detail sheet | Merges stored Supabase data + `/api/places/details`; stored-only when photo/quota flags on |
| Google Maps links | Outbound only — client-built URLs, no app API call |
| Plan thumbnails | Proxy or emoji fallback per client flag |
| **Discover tab** | User-initiated `/api/places/search`; **still renders direct `photoUrl` `<img>`** — not yet gated like Plan/trip cards. Future cleanup item. |
| **Maps JavaScript** | TripMap + hotel explore load Maps JS; may show **`OverQuotaMapError`** if Maps quota exhausted (separate from Places mock modes) |

---

## 10. Known limitations / future to-do

### Active — itinerary builder

- **Phase C: read global pool first (next)** — see §8. Load `destination_place_candidates` before live Google; top up only short categories/tags. Test sparingly; do not repeatedly click Generate.
- **Itinerary quality still not fully fixed** — day rhythm/density gaps remain; persistent pools reduce quota dependence but Phase C+ must land before quality improves materially.
- **Day rhythm / density not guaranteed** — Phase 1.5 improved meals but days can still collapse to breakfast + one activity; `topUpSparseDay` activity repair gives up too early; no full-day density gate.
- **Quota amplification (partially addressed)** — Phase B′ short-circuits live Places after quota exhaustion within a Generate request; Phase C will reduce initial live fetch volume. Pool-first for `fill-sparse` / `ensure-meals` remains future work.
- **Success response vs quality** — HTTP 200 + “Itinerary ready!” even when `missing_meals_after_generation` shows most days incomplete; full quality gate before wipe remains Phase G (future).
- **Trip deck / regenerate / refresh from saved candidates** — Phases D/E (future); `trip_candidate_pool` schema exists but is not wired.
- **Optional home base** — Generate currently requires a saved hotel; future phase.
- **Neighborhood / day clustering** — future phase.

### General

- **Maps JavaScript `OverQuotaMapError`** — visual maps may fail when Maps quota is exhausted even if Places mock modes are on; raise Maps quota cautiously for map testing only.
- **Lazy-load Maps JavaScript** — reduce automatic map load cost (TripMap + hotel explore both load Maps JS).
- **Live hotel pricing** — requires real provider/booking API before nightly filters (see §7).
- **Discover photos** — should respect photo-disable/proxy behavior (currently direct Google photo URLs in UI).
- **Caching / rate limiting** — Phase B write-through populates global pool; Phase C reads it first. Consider rate limits on autocomplete/search routes.
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
7. **Never commit `.env.local`.** Includes `SUPABASE_SERVICE_ROLE_KEY` for pool write-through.
8. Restart `npm run dev` after changing `NEXT_PUBLIC_*` env vars.

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
lib/itinerary/candidate-pool.ts                 — destination/candidate upsert, write-through (Phase B)
lib/itinerary/pool-tags.ts                      — pool tag mapping for cached candidates
lib/supabase/service.ts                         — service-role client for global pool writes
components/trip/hotel-section.tsx       — Hotel tab states, explore entry, save, trip-date defaults
components/trip/hotel-explore-panel.tsx — Explore list/map, filters, pins
components/trip/trip-dashboard.tsx      — Trip props, hides side map during hotel explore
lib/maps/hotel-explore.ts               — Types, query helpers, client-side filters
lib/maps/mock-hotel-explore.ts          — Destination-aware mock hotels + friendly errors
lib/maps/google-maps-link.ts            — Outbound Maps URLs
app/api/places/autocomplete/route.ts    — Lodging + destination text search (user-initiated)
app/api/itinerary/generate/route.ts     — Generate orchestration, pool fetch, post-passes
app/api/itinerary/add-rest/route.ts     — Rest block insert + reschedule
lib/itinerary/smart-generate.ts         — Day scheduler (meals, activities, manual places)
lib/itinerary/generate-diagnostics.ts   — Generate pool/day server logs
lib/itinerary/reschedule-day.ts         — Time chaining, rest intervals, chronological sort_order
lib/itinerary/apply-reschedule.ts       — Per-day / trip-wide reschedule DB updates
lib/itinerary/fill-sparse.ts            — Sparse-day top-up after Generate
lib/itinerary/ensure-meals.ts           — Last-resort B/L/D insertion after Generate
lib/itinerary/meal-slots.ts             — Meal insertion bounds, dedup rules
lib/itinerary/meal-locations.ts         — Meal search location, excursion helpers
components/trip/itinerary-section.tsx   — Plan UI, Generate handler, meal warning toast
COST_SAFETY_CHECKPOINT.md               — Cost controls (authoritative)
.env.example                            — Flag documentation
```
