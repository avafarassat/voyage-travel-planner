-- Day time bounds for itinerary scheduling
alter table public.trips
  add column if not exists day_start_time time default '08:00',
  add column if not exists day_end_time time default '22:00';
