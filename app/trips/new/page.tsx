"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

export default function NewTripPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    city: "",
    country: "",
    start_date: "",
    end_date: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast({ title: "Not logged in", variant: "destructive" });
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ city: form.city });
    if (form.country) params.set("country", form.country);

    let coverImageUrl: string | null = null;
    try {
      const coverRes = await fetch(`/api/trips/cover-image?${params}`);
      if (coverRes.ok) {
        const coverData = await coverRes.json();
        coverImageUrl = coverData.url ?? null;
      }
    } catch {
      // Cover image is optional — fall back to gradient
    }

    const { data, error } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
        name: form.name,
        city: form.city,
        country: form.country || null,
        start_date: form.start_date,
        end_date: form.end_date,
        cover_image_url: coverImageUrl,
      })
      .select()
      .single();

    setLoading(false);

    if (error) {
      toast({ title: "Failed to create trip", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Trip created!" });
    router.push(`/trips/${data.id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Create a new trip</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Trip name</Label>
                <Input
                  id="name"
                  placeholder="Barcelona Adventure"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="Barcelona"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country (optional)</Label>
                <Input
                  id="country"
                  placeholder="Spain"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start">Start date</Label>
                  <Input
                    id="start"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end">End date</Label>
                  <Input
                    id="end"
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating..." : "Create trip"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
