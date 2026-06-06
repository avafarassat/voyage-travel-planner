"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/utils";
import type { Flight } from "@/lib/types";
import { Plane, Upload, RefreshCw } from "lucide-react";

interface FlightsSectionProps {
  tripId: string;
  flights: Flight[];
  onUpdate: () => void;
  readOnly?: boolean;
}

export function FlightsSection({ tripId, flights, onUpdate, readOnly }: FlightsSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    airline: "",
    flight_number: "",
    departure_airport: "",
    arrival_airport: "",
    departure_time: "",
    arrival_time: "",
    confirmation_code: "",
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.from("flights").insert({
      trip_id: tripId,
      ...form,
      confirmation_code: form.confirmation_code || null,
      notes: form.notes || null,
    });

    setLoading(false);

    if (error) {
      toast({ title: "Failed to add flight", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Flight added" });
    setShowForm(false);
    setForm({
      airline: "",
      flight_number: "",
      departure_airport: "",
      arrival_airport: "",
      departure_time: "",
      arrival_time: "",
      confirmation_code: "",
      notes: "",
    });
    onUpdate();
  }

  async function handleUpload(flightId: string, file: File) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const path = `${user.id}/${tripId}/${flightId}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("boarding-passes")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      return;
    }

    const { data: signedData } = await supabase.storage
      .from("boarding-passes")
      .createSignedUrl(path, 60 * 60 * 24 * 365);

    await supabase
      .from("flights")
      .update({ boarding_pass_url: signedData?.signedUrl ?? path })
      .eq("id", flightId);

    toast({ title: "Boarding pass uploaded" });
    onUpdate();
  }

  async function handleRefresh(flightId: string) {
    setRefreshingId(flightId);
    const res = await fetch("/api/flights/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flightId }),
    });
    const data = await res.json();
    setRefreshingId(null);

    if (data.changed) {
      toast({ title: "Flight time updated!", description: data.status });
    } else {
      toast({ title: "Status refreshed", description: data.status });
    }
    onUpdate();
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-between">
          <h3 className="font-semibold">Flights</h3>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Add flight"}
          </Button>
        </div>
      )}

      {showForm && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add flight</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Airline</Label>
                  <Input
                    value={form.airline}
                    onChange={(e) => setForm({ ...form, airline: e.target.value })}
                    placeholder="Iberia"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Flight number</Label>
                  <Input
                    value={form.flight_number}
                    onChange={(e) => setForm({ ...form, flight_number: e.target.value })}
                    placeholder="IB2620"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input
                    value={form.departure_airport}
                    onChange={(e) => setForm({ ...form, departure_airport: e.target.value })}
                    placeholder="JFK"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    value={form.arrival_airport}
                    onChange={(e) => setForm({ ...form, arrival_airport: e.target.value })}
                    placeholder="BCN"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Departure</Label>
                  <Input
                    type="datetime-local"
                    value={form.departure_time}
                    onChange={(e) => setForm({ ...form, departure_time: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Arrival</Label>
                  <Input
                    type="datetime-local"
                    value={form.arrival_time}
                    onChange={(e) => setForm({ ...form, arrival_time: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirmation code</Label>
                <Input
                  value={form.confirmation_code}
                  onChange={(e) => setForm({ ...form, confirmation_code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Add flight"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {flights.length === 0 ? (
        <p className="text-sm text-muted-foreground">No flights added yet.</p>
      ) : (
        flights.map((flight) => (
          <Card key={flight.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                    <Plane className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {flight.airline} {flight.flight_number}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {flight.departure_airport} → {flight.arrival_airport}
                    </p>
                  </div>
                </div>
                {flight.status && (
                  <Badge variant="secondary">{flight.status}</Badge>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Depart</p>
                  <p>{formatDateTime(flight.departure_time)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Arrive</p>
                  <p>{formatDateTime(flight.arrival_time)}</p>
                </div>
              </div>
              {flight.confirmation_code && (
                <p className="mt-2 text-sm">
                  Confirmation: <span className="font-mono">{flight.confirmation_code}</span>
                </p>
              )}
              {!readOnly && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={refreshingId === flight.id}
                    onClick={() => handleRefresh(flight.id)}
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshingId === flight.id ? "animate-spin" : ""}`} />
                    Refresh status
                  </Button>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(flight.id, file);
                      }}
                    />
                    <span className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted">
                      <Upload className="h-3 w-3" />
                      Boarding pass
                    </span>
                  </label>
                </div>
              )}
              {flight.boarding_pass_url && (
                <a
                  href={flight.boarding_pass_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  View boarding pass
                </a>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
