import Link from "next/link";
import {
  MapPin,
  Plane,
  Calendar,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-background to-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <MapPin className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">Voyage</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <section className="text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground shadow-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Your one-stop travel planner
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Plan every detail of your trip in one beautiful place
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Store flights, hotels, restaurants, and activities on a color-coded
            map. Get daily itineraries based on proximity — like your custom
            Google Map, but smarter.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/signup">
                Start planning free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">I already have an account</Link>
            </Button>
          </div>
        </section>

        <section className="mt-24 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Plane,
              title: "Flights & boarding passes",
              desc: "Track flights, upload boarding passes, and refresh status.",
            },
            {
              icon: MapPin,
              title: "Interactive map",
              desc: "Color-coded pins for hotels, restaurants, bars, and sights.",
            },
            {
              icon: Calendar,
              title: "Daily itineraries",
              desc: "Auto-generated day plans grouped by neighborhood.",
            },
            {
              icon: Sparkles,
              title: "Discover places",
              desc: "Get restaurant and activity suggestions near your hotel.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <feature.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <div className="flex justify-center gap-6">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
        </div>
        <p className="mt-4">© {new Date().getFullYear()} Voyage</p>
      </footer>
    </div>
  );
}
