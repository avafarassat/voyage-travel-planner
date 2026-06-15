-- Trip destination map center (from Create Trip autocomplete or one-time geocode at create)
alter table public.trips
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision;
