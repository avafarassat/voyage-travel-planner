alter table public.itinerary_stops
  add column if not exists is_completed boolean not null default false;
