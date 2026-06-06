-- Optional reservation date/time for places (restaurant bookings, timed tickets, etc.)
alter table public.places
  add column if not exists reservation_date date,
  add column if not exists reservation_time time;
