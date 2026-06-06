"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/utils";
import { TRANSPORT_TYPES, type TransportBooking, type TransportType } from "@/lib/types";

interface TransportSectionProps {
  tripId: string;
  bookings: TransportBooking[];
  onUpdate: () => void;
  readOnly?: boolean;
}

export function TransportSection({
  tripId,
  bookings,
  onUpdate,
  readOnly,
}: TransportSectionProps) {
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: "train" as TransportType,
    title: "",
    pickup_location: "",
    dropoff_location: "",
    pickup_time: "",
    dropoff_time: "",
    confirmation_code: "",
    notes: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.from("transport_bookings").insert({
      trip_id: tripId,
      type: form.type,
      title: form.title,
      pickup_location: form.pickup_location || null,
      dropoff_location: form.dropoff_location || null,
      pickup_time: form.pickup_time || null,
      dropoff_time: form.dropoff_time || null,
      confirmation_code: form.confirmation_code || null,
      notes: form.notes || null,
    });

    setLoading(false);

    if (error) {
      toast({ title: "Failed to add transport", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Transport added" });
    setShowForm(false);
    onUpdate();
  }

  function getTypeEmoji(type: TransportType) {
    return TRANSPORT_TYPES.find((t) => t.value === type)?.emoji ?? "🚗";
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex justify-between">
          <h3 className="font-semibold">Transport</h3>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Add transport"}
          </Button>
        </div>
      )}

      {showForm && !readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add transport booking</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v as TransportType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.emoji} {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="AVE train to Madrid"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Pickup location</Label>
                  <Input
                    value={form.pickup_location}
                    onChange={(e) => setForm({ ...form, pickup_location: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dropoff location</Label>
                  <Input
                    value={form.dropoff_location}
                    onChange={(e) => setForm({ ...form, dropoff_location: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Pickup time</Label>
                  <Input
                    type="datetime-local"
                    value={form.pickup_time}
                    onChange={(e) => setForm({ ...form, pickup_time: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Dropoff time</Label>
                  <Input
                    type="datetime-local"
                    value={form.dropoff_time}
                    onChange={(e) => setForm({ ...form, dropoff_time: e.target.value })}
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
                {loading ? "Saving..." : "Add transport"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transport bookings yet.</p>
      ) : (
        bookings.map((booking) => (
          <Card key={booking.id}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getTypeEmoji(booking.type)}</span>
                <div>
                  <p className="font-semibold">{booking.title}</p>
                  <p className="text-sm capitalize text-muted-foreground">
                    {booking.type.replace("_", " ")}
                  </p>
                </div>
              </div>
              {(booking.pickup_location || booking.dropoff_location) && (
                <p className="mt-2 text-sm">
                  {booking.pickup_location} → {booking.dropoff_location}
                </p>
              )}
              {booking.pickup_time && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDateTime(booking.pickup_time)}
                </p>
              )}
              {booking.confirmation_code && (
                <p className="mt-1 text-sm font-mono">{booking.confirmation_code}</p>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
