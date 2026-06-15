# Cost-safety checkpoint — handoff for future chats

**Last updated:** 2026-06-14  
**Git checkpoint:** `a944d09` — *Gate photo features and improve place detail fallbacks*  
**Branch:** `main` (working tree clean at time of writing; auto fill-sparse gating added after audit)

Use this file when resuming work after Google Places quota issues or local dev cost controls.

---

## Why this exists

Google Places / Photo quota was exhausted (`OVER_QUERY_LIMIT`, photo `403`). We added **intentional cost controls** so the app stays usable locally without spamming Google or noisy failed requests. Several behaviors are **temporary** (env-gated). Others are **permanent** product improvements.

---

## Environment flags (local `.env.local`)

Set **both photo flags** while quota is exhausted or you want zero photo traffic:

```env
DISABLE_PLACE_PHOTO_PROXY=true
NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY=true
```

Set **both auto fill-sparse flags** to avoid surprise Places usage when opening Plan:

```env
DISABLE_AUTO_FILL_SPARSE=true
NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=true
```

| Flag | Scope | Effect |
|------|--------|--------|
| `DISABLE_PLACE_PHOTO_PROXY` | Server | Gates server routes listed below. Does **not** remove stored `photo_url` / `cover_image_url`. |
| `NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY` | Client (Next.js) | Plan thumbnails, trip cards, place detail sheet skip photo `<img>` / proxy requests; emoji/gradient fallbacks. |
| `DISABLE_AUTO_FILL_SPARSE` | Server | `/api/itinerary/fill-sparse-days` returns `{ filledDays: 0, skipped: true }` unless body includes `explicit: true`. No Google, no Supabase mutations from that route when skipped. |
| `NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE` | Client (Next.js) | Plan tab does **not** auto-POST `fill-sparse-days` on mount; stored itinerary renders normally. |

Documented in `.env.example`. **Restart dev server** after changing any `NEXT_PUBLIC_*` flag.

### Keys (unchanged)

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — browser-restricted key (Maps JS, some client-adjacent routes).
- `GOOGLE_MAPS_API_KEY` — server-only key; preferred for `/api/places/photo` proxy when photos are re-enabled.

---

## What is intentionally disabled (when flags are `true`)

### Client (`NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY=true`)

| Area | File | Behavior when disabled |
|------|------|------------------------|
| Plan stop thumbnails | `components/trip/itinerary-section.tsx` (`PlaceThumbnail`) | Emoji/category fallback; **no** `/api/places/photo` |
| Auto place photo backfill | `components/trip/itinerary-section.tsx` (`useEffect`) | **No** `POST /api/places/backfill-photos` |
| Auto sparse-day top-up | `components/trip/itinerary-section.tsx` (`useEffect`) | **No** `POST /api/itinerary/fill-sparse-days` on Plan mount |
| Trip list cover images | `components/trip/trip-card.tsx` | Gradient only; **no** direct Google `cover_image_url` `<img>` |
| Place detail hero image | `components/trip/place-detail-sheet.tsx` | Category emoji block; **no** `/api/places/photo` |

### Server (`DISABLE_PLACE_PHOTO_PROXY=true`)

| Route / code | File | Behavior when disabled |
|--------------|------|------------------------|
| Photo proxy | `app/api/places/photo/route.ts` | Returns 404 JSON (`Photo proxy disabled`) |
| Place photo backfill API | `app/api/places/backfill-photos/route.ts` | `{ updated: 0, skipped: true, reason: "photo proxy disabled" }`; no Google, no Supabase updates |
| Trip cover fetch API | `app/api/trips/cover-image/route.ts` | `{ url: null, skipped: true }`; no Google |
| Trips list cover backfill | `app/trips/page.tsx` (`backfillCoverImages`) | Skipped entirely on `/trips` load |
| Place details API | `app/api/places/details/route.ts` | Returns **stored** place row only; **no** `resolvePlacePhoto` / `fetchPlaceDetailProfile` Google calls |
| Fill sparse days API | `app/api/itinerary/fill-sparse-days/route.ts` | `{ filledDays: 0, skipped: true, reason: "auto fill sparse disabled" }` unless `explicit: true` in body; no Google |

### What still may call Google when flags are `false`

- Place search, discover, autocomplete, **Generate** (explicit button), suggest-stop, refresh-suggestion, geocode, etc. (unchanged by this checkpoint).
- `/api/itinerary/fill-sparse-days` with `explicit: true` (e.g. rest-for-remainder top-up after user action).
- `/api/places/details` — live Google profile (reviews, hours, `googleMapsUrl`, photo URLs) when flags are off and quota allows.
- Direct Google photo URLs in API responses when Google profile succeeds (detail sheet uses proxy when photos enabled).

### What does **not** call Google Directions API (permanent)

- Plan tab travel times: **coordinate estimates** only — `Est. walk`, `Est. drive`, `Est. transit` via `estimateDisplayTravelLegs` in `lib/itinerary/travel.ts`.
- No automatic `POST /api/directions/multi` from Plan UI.
- Commit: `1352917` — *Add estimated travel times to avoid automatic Directions API calls*.

---

## Permanent improvements (keep even after re-enabling photos)

| Feature | Commit | Notes |
|---------|--------|--------|
| Collapsible itinerary days | `11eca28` | Day 1 open by default; others collapsed; reduces DOM/photo load |
| Itinerary photo proxy path | `ea7bb30` | `/api/places/photo?placeId=...` when proxy enabled |
| Place detail stored fallbacks | `a944d09` | Name, address, rating, hours from Supabase when Google fails or flags on |
| Google Maps outbound link | `a944d09` | Client-built URL; no API call; uses `query` + `query_place_id` when both available |
| Trip cover `onError` | `a944d09` | Broken cover image → gradient when photos enabled |

---

## Place detail sheet (current behavior)

**Component:** `components/trip/place-detail-sheet.tsx`  
**Opened from:** Plan tab → click place name/thumbnail in `ItinerarySection` / `SortableStop`.

- Merges `place` prop with `/api/places/details` response.
- Photos: proxy when enabled; emoji when disabled; `onError` → emoji.
- **View on Google Maps:** outbound link only (`target="_blank"`, `rel="noreferrer"`):
  1. Valid `detail.googleMapsUrl`
  2. Else `query` + `query_place_id` (both required; do not use `query_place_id` alone)
  3. Else name/address search URL
- Does **not** render direct Google photo URLs in `<img>` when client flag is on.

---

## Collapsible Plan days (permanent)

**File:** `components/trip/itinerary-section.tsx`

- `expandedDayIds` state; Day 1 expanded on load.
- Collapsed days: header summary only (stop count, time range); no stop cards / thumbnails.
- Not persisted to DB or localStorage.

---

## How to undo temporary cost controls (when quota is restored)

1. In `.env.local`, remove or set:
   ```env
   DISABLE_PLACE_PHOTO_PROXY=false
   NEXT_PUBLIC_DISABLE_PLACE_PHOTO_PROXY=false
   DISABLE_AUTO_FILL_SPARSE=false
   NEXT_PUBLIC_DISABLE_AUTO_FILL_SPARSE=false
   ```
2. Confirm `GOOGLE_MAPS_API_KEY` is set and allowed for Places Photo (server).
3. **Restart dev server** (required for `NEXT_PUBLIC_*`).
4. Smoke test **one** photo before browsing full trip:
   - Open Plan → expand Day 1 → one thumbnail loads via `/api/places/photo`.
   - Open place detail → hero via proxy.
   - `/trips` → trip card cover (may still 403 if key/referrer wrong on direct stored URL when enabled).
5. Optional: trigger backfill once if many `photo_url` nulls (manual `POST /api/places/backfill-photos` with `tripId` — only when ready; was auto on Plan mount when disabled).
6. Optional: trigger sparse top-up once if needed (manual `POST /api/itinerary/fill-sparse-days` with `{ tripId, explicit: true }` — only when ready; was auto on Plan mount when disabled).

**Do not delete** stored `places.photo_url` or `trips.cover_image_url` — they remain in Supabase.

---

## Commits on this arc (reference)

```
a944d09 Gate photo features and improve place detail fallbacks
11eca28 Make itinerary days collapsible
ea7bb30 Proxy itinerary photos and add fallback handling
1352917 Add estimated travel times to avoid automatic Directions API calls
```

---

## Files touched by cost-safety work (grep anchors)

- `components/trip/itinerary-section.tsx` — `PLACE_PHOTO_PROXY_DISABLED`, `AUTO_FILL_SPARSE_DISABLED`, collapsible days, backfill skip
- `components/trip/trip-card.tsx` — cover image gating
- `components/trip/place-detail-sheet.tsx` — fallbacks, maps link, photo gating
- `app/api/places/photo/route.ts` — server disable
- `app/api/places/backfill-photos/route.ts` — server disable
- `app/api/places/details/route.ts` — stored-only when disabled
- `app/api/trips/cover-image/route.ts` — skip fetch when disabled
- `app/trips/page.tsx` — skip cover backfill when disabled
- `app/api/itinerary/fill-sparse-days/route.ts` — auto skip unless `explicit: true`
- `.env.example` — flag documentation

**Not changed:** scheduling, generate, meal logic, Directions travel-time estimation, sparse fill algorithm, itinerary placement.

---

## Barcelona test trip (optional)

- Trip ID: `8ed96750-9eaa-4f81-9967-72da883cae74`
- Verify script: `node scripts/verify-handoff.mjs` (reads `.env.local`)

---

## For future agents

- **Do not** re-enable Google Directions for Plan travel times without explicit product decision.
- **Do not** run Generate or manual backfills / fill-sparse while quota is exhausted unless user asks.
- When user says “photos work again,” undo **env flags first**, then verify keys/quota — not broad code reverts.
- Older narrative context may exist in `PROJECT_CONTEXT_V3.md.txt`; **this file is the cost-control source of truth.**

---

## Future roadmap (not implemented)

### Hotel explore — live nightly pricing

- **Future hotel pricing milestone:** connect a real hotel pricing/booking provider before adding nightly rate filters to Hotel Explore.
- Google Places Text Search provides `priceLevel` ($–$$$$) only — **not** actual nightly rates.
- **Do not** fake nightly prices from `priceLevel` or other Places fields.
- Until a trusted pricing source exists, Hotel Explore filters should remain rating + price level only (client-side, no extra Google calls on filter change).
- Local mock explore (`NEXT_PUBLIC_USE_MOCK_HOTEL_EXPLORE`) should not add fake nightly prices.
