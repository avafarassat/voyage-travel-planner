-- Persistent destination candidate pools (Phase A — schema only)
-- Global inventory is server-populated; trip decks are per-trip scheduler state.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.candidate_global_status as enum (
  'active',
  'retired',
  'pending_refresh'
);

create type public.trip_candidate_status as enum (
  'available',
  'placed',
  'rejected',
  'removed_by_user',
  'reserved'
);

create type public.candidate_rejection_reason as enum (
  'opening_hours',
  'proximity',
  'duplicate_brand',
  'duplicate_day',
  'scheduler_failed',
  'user_dismissed',
  'low_quality'
);

-- ---------------------------------------------------------------------------
-- destinations — shared destination registry (city/region anchor)
-- ---------------------------------------------------------------------------

create table if not exists public.destinations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  city text not null,
  country text,
  center_lat double precision,
  center_lng double precision,
  google_place_id text,
  last_pool_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_destinations_slug on public.destinations (slug);

alter table public.destinations enable row level security;

-- No client policies: global destination registry is server-controlled (service role).

-- ---------------------------------------------------------------------------
-- destination_place_candidates — shared destination inventory (no photos)
-- ---------------------------------------------------------------------------

create table if not exists public.destination_place_candidates (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations (id) on delete cascade,
  google_place_id text not null,

  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  primary_category text not null check (
    primary_category in (
      'restaurant',
      'bar',
      'nightlife',
      'activity',
      'monument',
      'museum'
    )
  ),
  pool_tags text[] not null default '{}',
  google_types text[] not null default '{}',

  rating double precision,
  user_ratings_total int,
  price_level int,
  opening_hours jsonb,

  is_sit_down_restaurant boolean not null default false,
  is_experience boolean not null default false,
  is_park_nature boolean not null default false,

  quality_score double precision not null default 0,
  global_status public.candidate_global_status not null default 'active',
  permanently_closed boolean not null default false,

  discovered_at timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  discovery_source text,

  unique (destination_id, google_place_id)
);

create index if not exists idx_dpc_destination_id on public.destination_place_candidates (destination_id);

create index if not exists idx_dpc_destination_active on public.destination_place_candidates (destination_id, global_status)
  where global_status = 'active';

create index if not exists idx_dpc_stale_refresh on public.destination_place_candidates (last_refreshed_at)
  where global_status = 'active';

create index if not exists idx_dpc_google_place_id on public.destination_place_candidates (google_place_id);

create index if not exists idx_dpc_pool_tags on public.destination_place_candidates using gin (pool_tags);

alter table public.destination_place_candidates enable row level security;

-- No client policies: shared inventory is written/read via server routes (service role).

-- ---------------------------------------------------------------------------
-- trip_candidate_pool — per-trip candidate deck and scheduler state
-- ---------------------------------------------------------------------------

create table if not exists public.trip_candidate_pool (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  destination_candidate_id uuid references public.destination_place_candidates (id) on delete set null,
  google_place_id text not null,

  name text not null,
  lat double precision not null,
  lng double precision not null,
  primary_category text not null check (
    primary_category in (
      'restaurant',
      'bar',
      'nightlife',
      'activity',
      'monument',
      'museum'
    )
  ),
  pool_tags text[] not null default '{}',
  opening_hours jsonb,
  rating double precision,

  status public.trip_candidate_status not null default 'available',
  rejection_reason public.candidate_rejection_reason,
  placed_stop_id uuid references public.itinerary_stops (id) on delete set null,
  placed_day_id uuid references public.itinerary_days (id) on delete set null,

  generation_run_id uuid not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (trip_id, google_place_id, generation_run_id)
);

create index if not exists idx_tcp_trip_id on public.trip_candidate_pool (trip_id);

create index if not exists idx_tcp_trip_status on public.trip_candidate_pool (trip_id, status);

create index if not exists idx_tcp_generation_run on public.trip_candidate_pool (trip_id, generation_run_id);

create index if not exists idx_tcp_google_place_id on public.trip_candidate_pool (google_place_id);

create index if not exists idx_tcp_pool_tags on public.trip_candidate_pool using gin (pool_tags);

alter table public.trip_candidate_pool enable row level security;

create policy "Users can CRUD own trip candidate pool"
  on public.trip_candidate_pool
  for all
  using (
    exists (
      select 1
      from public.trips
      where trips.id = trip_candidate_pool.trip_id
        and trips.user_id = auth.uid()
    )
  );

create policy "Public read trip candidate pool via shared trip"
  on public.trip_candidate_pool
  for select
  using (
    exists (
      select 1
      from public.trips
      where trips.id = trip_candidate_pool.trip_id
        and trips.is_public = true
    )
  );
