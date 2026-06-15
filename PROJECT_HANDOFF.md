# Voyage — project handoff

**Last updated:** 2026-06-14  
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
b4699b5 Default hotel dates to trip dates
d9035f3 Make mock hotel explore destination aware
4eab4c1 Add trip deletion and duplicate name validation
590d7ab Add destination autocomplete and map centering
70cf19a Add destination autocomplete and date validation
702ea2a Add destination autocomplete to create trip form
5ff1ccd Add hotel exploration map and filters
936d13e Improve hotel tab saved and empty states
1375dc5 Gate automatic fill sparse for cost safety
260009a Document Google cost safety checkpoint
a944d09 Gate photo features and improve place detail fallbacks
11eca28 Make itinerary days collapsible
1352917 Add estimated travel times to avoid automatic Directions API calls
```

Older narrative context may exist in `PROJECT_CONTEXT_V3.md.txt`. For cost controls and env flags, **`COST_SAFETY_CHECKPOINT.md` is the source of truth.**

---

## 3. Cost-safety rules

**Always read [`COST_SAFETY_CHECKPOINT.md`](./COST_SAFETY_CHECKPOINT.md) before touching Google-related features.**

### Do not (unless Ava explicitly asks)

- Run **Generate** itinerary (heavy Google usage).
- Call **Google Directions API** (Plan uses local coordinate estimates only). Keep Directions at **0/day** or disabled.
- Add **automatic** Google Places / Details / Photo calls on page or tab load.
- Commit **`.env.local`** (secrets and local flags).

### Do

- Keep **searches user-initiated** (button click, explicit typing in autocomplete).
- Use **small, focused commits** by feature.
- Check `git status --short` before and after changes.
- Smoke-test with **mock modes** when Google quota is exhausted (see env flags below).
- Raise **Maps JavaScript** quota cautiously if needed for visual map testing only.

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

**Key file:** `components/trip/itinerary-section.tsx`

- **Collapsible days** — Day 1 expanded by default; others collapsed (not persisted).
- **Travel times** — local estimates (`Est. walk` / `drive` / `transit`) via `estimateDisplayTravelLegs` in `lib/itinerary/travel.ts`. **No Directions API** from Plan UI.
- **Auto fill-sparse** gated by env flags — Plan mount does not POST `fill-sparse-days` when `NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true`.
- **Generate** is explicit button action only; still heavy — do not run casually.
- Barcelona itinerary had prior fixes for **meal timing**, **anchors**, **opening-hours enrichment**, and **sparse-day rescheduling** (commits `f32cf6c`, `6385f77`).

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

- **Maps JavaScript `OverQuotaMapError`** — visual maps may fail when Maps quota is exhausted even if Places mock modes are on; raise Maps quota cautiously for map testing only.
- **Lazy-load Maps JavaScript** — reduce automatic map load cost (TripMap + hotel explore both load Maps JS).
- **Live hotel pricing** — requires real provider/booking API before nightly filters (see §7).
- **Discover photos** — should respect photo-disable/proxy behavior (currently direct Google photo URLs in UI).
- **Caching / rate limiting** — consider for autocomplete/search routes.
- **DB-level unique trip-name index** — after cleaning any existing duplicate names per user.
- **Dev banner** — surface when cost-safety or mock flags are active.
- **Directions routes** — dormant API routes still exist; consider hard-gating or removal.
- **Fill sparse days** — consider explicit “Fill sparse days” button instead of hidden `explicit: true` flow.

---

## 11. Developer workflow reminders

1. Read `COST_SAFETY_CHECKPOINT.md` before Google work.
2. Apply migration `007_trip_destination_coords.sql` if testing destination map centering.
3. `git status --short` before and after edits.
4. **Do not commit or push** until Ava reviews (unless explicitly asked).
5. Small commits by feature; complete sentences in commit messages.
6. When quota is exhausted: enable cost flags + mock modes (`NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE`, `NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE`).
7. **Never commit `.env.local`.**
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
components/trip/hotel-section.tsx       — Hotel tab states, explore entry, save, trip-date defaults
components/trip/hotel-explore-panel.tsx — Explore list/map, filters, pins
components/trip/trip-dashboard.tsx      — Trip props, hides side map during hotel explore
lib/maps/hotel-explore.ts               — Types, query helpers, client-side filters
lib/maps/mock-hotel-explore.ts          — Destination-aware mock hotels + friendly errors
lib/maps/google-maps-link.ts            — Outbound Maps URLs
app/api/places/autocomplete/route.ts    — Lodging + destination text search (user-initiated)
COST_SAFETY_CHECKPOINT.md               — Cost controls (authoritative)
.env.example                            — Flag documentation
```
