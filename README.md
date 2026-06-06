# Voyage — Travel Planner

A one-stop travel planning web app. Store flights, hotels, transport, and places on a color-coded map, then auto-generate daily itineraries by proximity.

## Quick start

1. Follow [SETUP.md](./SETUP.md) to create accounts and configure API keys
2. Run the Supabase migration in `supabase/migrations/001_initial_schema.sql`
3. Install and run:

```bash
cp .env.example .env.local
# Fill in your keys in .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Features

- Trip dashboard with flights, transport, hotel, places, map, and itinerary
- Color-coded map pins (hotel, restaurants, bars, sights, museums, activities)
- Proximity-based daily itinerary generator with drag-and-drop reordering
- Google Places discovery near your hotel
- Walk times between itinerary stops
- Boarding pass uploads
- Share read-only trip links with companions
- PWA install support for phone home screen

## Deploy

Push to GitHub and import on [Vercel](https://vercel.com). Add all environment variables from `.env.local`.

## Tech stack

Next.js 15 · Supabase · Google Maps Platform · Tailwind CSS · shadcn/ui
