-- Travel Planner initial schema with Row Level Security

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  created_at timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trips
create table if not exists public.trips (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  city text not null,
  country text,
  start_date date not null,
  end_date date not null,
  cover_image_url text,
  share_token text unique,
  is_public boolean default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.trips enable row level security;

create policy "Users can CRUD own trips" on public.trips for all using (auth.uid() = user_id);
create policy "Public trips readable by share token" on public.trips for select using (is_public = true);

-- Hotels
create table if not exists public.hotels (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips on delete cascade not null,
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  check_in date,
  check_out date,
  notes text,
  created_at timestamptz default now() not null
);

alter table public.hotels enable row level security;

create policy "Users can CRUD own hotels" on public.hotels for all
  using (exists (select 1 from public.trips where trips.id = hotels.trip_id and trips.user_id = auth.uid()));

create policy "Public read hotels via shared trip" on public.hotels for select
  using (exists (select 1 from public.trips where trips.id = hotels.trip_id and trips.is_public = true));

-- Places
create table if not exists public.places (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips on delete cascade not null,
  name text not null,
  category text not null check (category in ('restaurant', 'bar', 'nightlife', 'activity', 'monument', 'museum')),
  address text,
  lat double precision not null,
  lng double precision not null,
  notes text,
  source text default 'manual' check (source in ('manual', 'suggested')),
  google_place_id text,
  rating double precision,
  photo_url text,
  reservation_date date,
  reservation_time time,
  created_at timestamptz default now() not null
);

alter table public.places enable row level security;

create policy "Users can CRUD own places" on public.places for all
  using (exists (select 1 from public.trips where trips.id = places.trip_id and trips.user_id = auth.uid()));

create policy "Public read places via shared trip" on public.places for select
  using (exists (select 1 from public.trips where trips.id = places.trip_id and trips.is_public = true));

-- Flights
create table if not exists public.flights (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips on delete cascade not null,
  airline text not null,
  flight_number text not null,
  departure_airport text not null,
  arrival_airport text not null,
  departure_time timestamptz not null,
  arrival_time timestamptz not null,
  confirmation_code text,
  notes text,
  boarding_pass_url text,
  status text,
  status_updated_at timestamptz,
  created_at timestamptz default now() not null
);

alter table public.flights enable row level security;

create policy "Users can CRUD own flights" on public.flights for all
  using (exists (select 1 from public.trips where trips.id = flights.trip_id and trips.user_id = auth.uid()));

create policy "Public read flights via shared trip" on public.flights for select
  using (exists (select 1 from public.trips where trips.id = flights.trip_id and trips.is_public = true));

-- Transport bookings
create table if not exists public.transport_bookings (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips on delete cascade not null,
  type text not null check (type in ('car_rental', 'shuttle', 'train', 'rideshare', 'bus', 'other')),
  title text not null,
  pickup_location text,
  dropoff_location text,
  pickup_time timestamptz,
  dropoff_time timestamptz,
  confirmation_code text,
  notes text,
  created_at timestamptz default now() not null
);

alter table public.transport_bookings enable row level security;

create policy "Users can CRUD own transport" on public.transport_bookings for all
  using (exists (select 1 from public.trips where trips.id = transport_bookings.trip_id and trips.user_id = auth.uid()));

create policy "Public read transport via shared trip" on public.transport_bookings for select
  using (exists (select 1 from public.trips where trips.id = transport_bookings.trip_id and trips.is_public = true));

-- Itinerary days
create table if not exists public.itinerary_days (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references public.trips on delete cascade not null,
  day_number int not null,
  date date not null,
  created_at timestamptz default now() not null,
  unique(trip_id, day_number)
);

alter table public.itinerary_days enable row level security;

create policy "Users can CRUD own itinerary days" on public.itinerary_days for all
  using (exists (select 1 from public.trips where trips.id = itinerary_days.trip_id and trips.user_id = auth.uid()));

create policy "Public read itinerary days via shared trip" on public.itinerary_days for select
  using (exists (select 1 from public.trips where trips.id = itinerary_days.trip_id and trips.is_public = true));

-- Itinerary stops
create table if not exists public.itinerary_stops (
  id uuid default gen_random_uuid() primary key,
  itinerary_day_id uuid references public.itinerary_days on delete cascade not null,
  place_id uuid references public.places on delete cascade not null,
  sort_order int not null default 0,
  created_at timestamptz default now() not null
);

alter table public.itinerary_stops enable row level security;

create policy "Users can CRUD own itinerary stops" on public.itinerary_stops for all
  using (exists (
    select 1 from public.itinerary_days d
    join public.trips t on t.id = d.trip_id
    where d.id = itinerary_stops.itinerary_day_id and t.user_id = auth.uid()
  ));

create policy "Public read itinerary stops via shared trip" on public.itinerary_stops for select
  using (exists (
    select 1 from public.itinerary_days d
    join public.trips t on t.id = d.trip_id
    where d.id = itinerary_stops.itinerary_day_id and t.is_public = true
  ));

-- Storage bucket for boarding passes
insert into storage.buckets (id, name, public)
values ('boarding-passes', 'boarding-passes', false)
on conflict (id) do nothing;

create policy "Users can upload boarding passes"
  on storage.objects for insert
  with check (bucket_id = 'boarding-passes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view own boarding passes"
  on storage.objects for select
  using (bucket_id = 'boarding-passes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own boarding passes"
  on storage.objects for delete
  using (bucket_id = 'boarding-passes' and auth.uid()::text = (storage.foldername(name))[1]);

-- Indexes
create index if not exists idx_trips_user_id on public.trips(user_id);
create index if not exists idx_trips_share_token on public.trips(share_token);
create index if not exists idx_places_trip_id on public.places(trip_id);
create index if not exists idx_itinerary_days_trip_id on public.itinerary_days(trip_id);
