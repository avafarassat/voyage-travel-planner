# Travel Planner — Progress Checklist

## Setup
- [x] Node.js installed
- [x] Project scaffolded (Next.js + Tailwind + shadcn/ui)
- [x] `.env.example` with all required keys
- [x] `SETUP.md` with account creation guide

## Features
- [x] Landing page
- [x] Auth (email + Google OAuth callback)
- [x] Trip CRUD (create, list, view)
- [x] Hotel entry with geocoding
- [x] Places entry with categories
- [x] Interactive map with color-coded pins
- [x] Flights with boarding pass upload
- [x] Transport bookings
- [x] Itinerary generator with drag-and-drop
- [x] Discover nearby (Google Places)
- [x] Walk times between stops (Directions API)
- [x] Trip sharing (read-only link)
- [x] Privacy & Terms pages
- [x] PWA manifest
- [x] Row-level security in Supabase migration
- [x] API rate limiting

## Your next steps
1. Run the Supabase migration (`supabase/migrations/001_initial_schema.sql`)
2. Copy `.env.example` to `.env.local` and add your API keys
3. Run `npm install && npm run dev`
4. Push to GitHub and deploy on Vercel
