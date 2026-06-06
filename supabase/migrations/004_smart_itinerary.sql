-- Smart itinerary: trip interests, extended stops (meals, rest), opening hours cache

alter table public.trips
  add column if not exists interests text[] default '{}';

alter table public.places
  add column if not exists opening_hours jsonb;

alter table public.itinerary_stops
  alter column place_id drop not null;

alter table public.itinerary_stops
  add column if not exists stop_type text not null default 'place'
    check (stop_type in ('place', 'meal', 'rest')),
  add column if not exists meal_type text
    check (meal_type is null or meal_type in ('breakfast', 'lunch', 'dinner')),
  add column if not exists title text,
  add column if not exists duration_minutes int,
  add column if not exists scheduled_time time,
  add column if not exists suggestion_key text,
  add column if not exists is_suggested boolean default false;
