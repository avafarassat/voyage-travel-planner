import Link from "next/link";
import { Plus, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/layout/app-header";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { TripCard } from "@/components/trip/trip-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchCityCoverImage } from "@/lib/trips/cover-image";
import { isTripPast } from "@/lib/utils";
import type { Trip } from "@/lib/types";

async function backfillCoverImages(trips: Trip[], supabase: Awaited<ReturnType<typeof createClient>>) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === "your-google-maps-api-key") return trips;

  const updated = [...trips];
  for (let i = 0; i < updated.length; i++) {
    const trip = updated[i];
    const url = await fetchCityCoverImage(trip.city, trip.country, apiKey);
    if (!url || url === trip.cover_image_url) continue;

    await supabase.from("trips").update({ cover_image_url: url }).eq("id", trip.id);
    updated[i] = { ...trip, cover_image_url: url };
  }
  return updated;
}

export default async function TripsPage() {
  const supabase = await createClient();
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .order("start_date", { ascending: true });

  let tripList = (trips ?? []) as Trip[];
  tripList = await backfillCoverImages(tripList, supabase);

  const upcoming = tripList.filter((t) => !isTripPast(t.end_date));
  const past = tripList.filter((t) => isTripPast(t.end_date)).reverse();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Trips</h1>
            <p className="text-muted-foreground">Plan and manage your adventures</p>
          </div>
          <Button asChild>
            <Link href="/trips/new">
              <Plus className="h-4 w-4" />
              New trip
            </Link>
          </Button>
        </div>

        {tripList.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
                <MapPin className="h-7 w-7 text-accent-foreground" />
              </div>
              <h2 className="text-lg font-semibold">No trips yet</h2>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Create your first trip to start adding flights, hotels, and places on a map.
              </p>
              <Button className="mt-6" asChild>
                <Link href="/trips/new">Create your first trip</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {upcoming.length > 0 && (
              <section>
                {past.length > 0 && (
                  <h2 className="mb-4 text-sm font-medium text-muted-foreground">Upcoming</h2>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {upcoming.map((trip) => (
                    <TripCard key={trip.id} trip={trip} />
                  ))}
                </div>
              </section>
            )}

            {past.length > 0 && (
              <section>
                <h2 className="mb-4 text-sm font-medium text-muted-foreground">Past trips</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {past.map((trip) => (
                    <TripCard key={trip.id} trip={trip} isPast />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      <InstallPrompt />
    </div>
  );
}
