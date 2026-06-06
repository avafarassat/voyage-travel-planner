# Travel Planner — Setup Guide

Complete these steps once before running the app locally.

## 1. Install Node.js

Download and install the **LTS** version from [nodejs.org](https://nodejs.org).

Verify in Terminal:
```bash
node --version   # should show v20+ or v22+
npm --version
```

## 2. Install Xcode Command Line Tools (for git)

If prompted when running git commands:
```bash
xcode-select --install
```

## 3. Create accounts (free tiers)

| Service | Purpose | Link |
|---------|---------|------|
| **Supabase** | Database, auth, file storage | [supabase.com](https://supabase.com) |
| **Google Cloud** | Maps, Places, Geocoding, Directions | [console.cloud.google.com](https://console.cloud.google.com) |
| **GitHub** | Code hosting | [github.com](https://github.com) |
| **Vercel** | Deployment | [vercel.com](https://vercel.com) |

### Google Cloud APIs to enable
1. Maps JavaScript API
2. Places API (New)
3. Geocoding API
4. Directions API

Create an API key and restrict it to your domains in production.

Set a **billing budget alert** at $10/month in Google Cloud Console.

### Supabase setup
1. Create a new project
2. Go to **SQL Editor** → run the migration in `supabase/migrations/001_initial_schema.sql`
3. Go to **Authentication → Providers** → enable Email and Google (optional)
4. Go to **Storage** → the migration creates the `boarding-passes` bucket
5. Copy your **Project URL** and **anon key** from Settings → API

## 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local` with your keys.

## 5. Install and run

```bash
cd ~/travel-planner
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 6. Deploy to Vercel

1. Push code to GitHub
2. Import repo at [vercel.com/new](https://vercel.com/new)
3. Add all environment variables from `.env.local`
4. Deploy

## 7. Add to phone home screen (PWA)

After deploying, open the URL on your phone → browser menu → **Add to Home Screen**.
