"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { PLACE_CATEGORIES, type Hotel, type PlaceCategory, type PlaceSearchResult } from "@/lib/types";
import { googleTypeToCategory } from "@/lib/places/google";
import { Search, Star } from "lucide-react";

interface DiscoverSectionProps {
  tripId: string;
  hotel: Hotel | null;
  onUpdate: () => void;
}

export function DiscoverSection({ tripId, hotel, onUpdate }: DiscoverSectionProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PlaceCategory>("restaurant");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!hotel) {
      toast({ title: "Add your hotel first", description: "We need a home base to search nearby.", variant: "destructive" });
      return;
    }

    setLoading(true);
    const res = await fetch("/api/places/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: query || `${category} near ${hotel.name}`,
        lat: hotel.lat,
        lng: hotel.lng,
        category,
      }),
    });

    const data = await res.json();
    setLoading(false);
    setResults(data.results ?? []);
  }

  async function handleSave(result: PlaceSearchResult) {
    setSavingId(result.placeId);
    const supabase = createClient();

    const { error } = await supabase.from("places").insert({
      trip_id: tripId,
      name: result.name,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
      category: googleTypeToCategory(result.types) || category,
      source: "suggested",
      google_place_id: result.placeId,
      rating: result.rating ?? null,
      photo_url: result.photoUrl ?? null,
    });

    setSavingId(null);

    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Saved to your trip!" });
    onUpdate();
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Discover nearby</h3>
      {!hotel && (
        <p className="text-sm text-muted-foreground">
          Set your hotel as home base to get suggestions nearby.
        </p>
      )}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="space-y-2">
          <Label>Search</Label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="tapas near Eixample"
          />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as PlaceCategory)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLACE_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.emoji} {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={loading || !hotel}>
          <Search className="h-4 w-4" />
          {loading ? "Searching..." : "Search"}
        </Button>
      </form>

      <div className="space-y-3">
        {results.map((result) => (
          <Card key={result.placeId}>
            <CardContent className="flex gap-3 p-3">
              {result.photoUrl && (
                <img
                  src={result.photoUrl}
                  alt={result.name}
                  className="h-16 w-16 rounded-lg object-cover"
                />
              )}
              <div className="flex-1">
                <p className="font-medium">{result.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{result.address}</p>
                {result.rating && (
                  <div className="mt-1 flex items-center gap-1 text-xs">
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    {result.rating.toFixed(1)}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                disabled={savingId === result.placeId}
                onClick={() => handleSave(result)}
              >
                {savingId === result.placeId ? "..." : "Save"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
