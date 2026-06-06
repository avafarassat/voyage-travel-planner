-- Add nightlife place category (clubs, lounges, etc.)
alter table public.places drop constraint if exists places_category_check;

-- If the previous club_lounge migration was applied, migrate existing rows
update public.places set category = 'nightlife' where category = 'club_lounge';

alter table public.places
  add constraint places_category_check
  check (category in ('restaurant', 'bar', 'nightlife', 'activity', 'monument', 'museum'));
