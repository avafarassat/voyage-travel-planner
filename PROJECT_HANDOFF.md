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
5ff1ccd Add hotel exploration map and filters
936d13e Improve hotel tab saved and empty states
1375dc5 Gate automatic fill sparse for cost safety
260009a Document Google cost safety checkpoint
a944d09 Gate photo features and improve place detail fallbacks
11eca28 Make itinerary days collapsible
1352917 Add estimated travel times to avoid automatic Directions API calls
6385f77 Fix meal candidate validation and opening-hours enrichment
f32cf6c Fix Barcelona itinerary meal timing and reschedule rhythm
```

Older narrative context may exist in `PROJECT_CONTEXT_V3.md.txt`. For cost controls and env flags, **`COST_SAFETY_CHECKPOINT.md` is the source of truth.**

---

## 3. Cost-safety rules

**Always read [`COST_SAFETY_CHECKPOINT.md`](./COST_SAFETY_CHECKPOINT.md) before touching Google-related features.**

### Do not (unless Ava explicitly asks)

- Run **Generate** itinerary (heavy Google usage).
- Call **Google Directions API** (Plan uses local coordinate estimates only).
- Add **automatic** Google Places / Details / Photo calls on page or tab load.
- Commit **`.env.local`** (secrets and local flags).

### Do

- Keep **searches user-initiated** (button click, explicit typing in autocomplete).
- Use **small, focused commits** by feature.
- Check `git status --short` before and after changes.
- Smoke-test in **mock hotel mode** when Google quota is exhausted.
- Use **mock destination autocomplete** on Create Trip when quota is exhausted (`NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE=true`).

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

Documented in `.env.example`.

### What not to casually change

Scheduling, generate logic, meal placement, Directions routes, travel-time estimation, photo proxy internals, fill-sparse algorithm, itinerary placement — unless the task explicitly requires it.

---

## 4. Hotel tab — current state

**Key files:** `components/trip/hotel-section.tsx`, `components/trip/hotel-explore-panel.tsx`, `lib/maps/hotel-explore.ts`, `lib/maps/mock-hotel-explore.ts`, `lib/maps/google-maps-link.ts`

### Saved hotel

- Collapsed **summary** by default (name, address, check-in/out, notes).
- **Edit hotel** expands the full manual form (`PlaceAutocompleteInput` for lodging — searches only when user types).

### No saved hotel

- Empty state with **Explore hotels** and **Enter manually**.

### Explore hotels (Phase C — commit `5ff1ccd`)

- **User-initiated lodging search only** — no search on Hotel tab load or component mount.
- Click **Explore hotels** or **Search** → one `/api/places/autocomplete?type=lodging` call (unless mock flag is on).
- **List + map** layout; global side map hidden while exploring on desktop.
- Hotel **pins** on explore map; selected pin is **darker purple and larger** with anchor dot; info window offset so pin stays visible.
- **View on Google Maps** — outbound URL only (`lib/maps/google-maps-link.ts`), no app API call.
- **Select hotel** saves name, address, lat, lng (+ existing check-in/out/notes); calls `onUpdate()`; collapses to summary.
- Does **not** persist `google_place_id` (hotels table has no column).
- **Client-side filters only** (no API on filter change):
  - Minimum rating (Any, 4.0+, 4.5+, 4.7+)
  - Price level ($, $$, $$$, $$$$)
- **No nightly min/max filters** — real nightly pricing is not available from Google Places.
- **Quota-safe errors** — friendly message, not raw Google text; **Enter manually** + **Back** remain visible.
- **Mock mode:** `NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE=true` → hardcoded Barcelona hotels, zero Places calls.

### Future — live hotel pricing

Connect a **real hotel pricing/booking provider** before adding nightly rate filters. **Do not** fake nightly prices from Google `priceLevel`. See `COST_SAFETY_CHECKPOINT.md` → Future roadmap.

---

## 5. Plan / itinerary — current state

**Key file:** `components/trip/itinerary-section.tsx`

- **Collapsible days** — Day 1 expanded by default; others collapsed (not persisted).
- **Travel times** — local estimates (`Est. walk` / `drive` / `transit`) via `estimateDisplayTravelLegs` in `lib/itinerary/travel.ts`. **No Directions API** from Plan UI.
- **Auto fill-sparse** gated by env flags — Plan mount does not POST `fill-sparse-days` when `NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true`.
- **Generate** is explicit button action only; still heavy — do not run casually.
- Barcelona itinerary had prior fixes for **meal timing**, **anchors**, **opening-hours enrichment**, and **sparse-day rescheduling** (commits `f32cf6c`, `6385f77`).

---

## 6. Google / photo / details — current state

| Area | Behavior |
|------|----------|
| Place photos | Proxied via `/api/places/photo` when enabled; emoji/gradient fallbacks when `DISABLE_*_PHOTO_PROXY` flags are true |
| Trip covers | Gated; backfill skipped on `/trips` load when disabled |
| Place detail sheet | Merges stored Supabase data + `/api/places/details`; stored-only when photo/quota flags on |
| Google Maps links | Outbound only — client-built URLs, no app API call |
| Plan thumbnails | Proxy or emoji fallback per client flag |
| **Discover tab** | User-initiated `/api/places/search`; **still renders direct `photoUrl` `<img>`** — not yet gated like Plan/trip cards. Future cleanup item. |

---

## 7. Known limitations / future to-do

- **Lazy-load Maps JavaScript** — reduce automatic map load cost (TripMap + hotel explore both load Maps JS).
- **Live hotel pricing** — requires real provider/booking API before nightly filters (see §4).
- **Discover photos** — should respect photo-disable/proxy behavior (currently direct Google photo URLs in UI).
- **Caching / rate limiting** — consider for autocomplete/search routes.
- **Dev banner** — surface when cost-safety or mock flags are active.
- **Directions routes** — dormant API routes still exist; consider hard-gating or removal.
- **Fill sparse days** — consider explicit “Fill sparse days” button instead of hidden `explicit: true` flow.

---

## 8. Developer workflow reminders

1. Read `COST_SAFETY_CHECKPOINT.md` before Google work.
2. `git status --short` before and after edits.
3. **Do not commit or push** until Ava reviews (unless explicitly asked).
4. Small commits by feature; complete sentences in commit messages.
5. When quota is exhausted: enable cost flags + `NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE=true` for hotel UI smoke tests, and/or `NEXT_PUBLIC_USE_MOCK_DESTINATION_AUTOCOMPLETE=true` for Create Trip destination autocomplete.
6. **Never commit `.env.local`.**
7. Restart `npm run dev` after changing `NEXT_PUBLIC_*` env vars.

---

## Quick file map (hotel + cost safety)

```
components/trip/hotel-section.tsx       — Hotel tab states, explore entry, save
components/trip/hotel-explore-panel.tsx — Explore list/map, filters, pins
components/trip/trip-dashboard.tsx      — Hides side map during hotel explore
lib/maps/hotel-explore.ts               — Types, query helpers, client-side filters
lib/maps/mock-hotel-explore.ts          — Mock mode + friendly search errors
lib/maps/google-maps-link.ts            — Outbound Maps URLs
app/api/places/autocomplete/route.ts    — Lodging text search (user-initiated)
COST_SAFETY_CHECKPOINT.md               — Cost controls (authoritative)
.env.example                            — Flag documentation
```
