"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { generateShareToken } from "@/lib/utils";
import type { Trip } from "@/lib/types";
import { Copy, Link2, Share2 } from "lucide-react";

interface ShareSectionProps {
  trip: Trip;
  onUpdate: () => void;
}

export function ShareSection({ trip, onUpdate }: ShareSectionProps) {
  const [loading, setLoading] = useState(false);

  const shareUrl = trip.share_token
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/share/${trip.share_token}`
    : null;

  async function enableSharing() {
    setLoading(true);
    const supabase = createClient();
    const token = trip.share_token ?? generateShareToken();

    const { error } = await supabase
      .from("trips")
      .update({ share_token: token, is_public: true })
      .eq("id", trip.id);

    setLoading(false);

    if (error) {
      toast({ title: "Failed to enable sharing", variant: "destructive" });
      return;
    }

    toast({ title: "Sharing enabled!" });
    onUpdate();
  }

  async function disableSharing() {
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase
      .from("trips")
      .update({ is_public: false })
      .eq("id", trip.id);

    setLoading(false);

    if (error) {
      toast({ title: "Failed to disable sharing", variant: "destructive" });
      return;
    }

    toast({ title: "Sharing disabled" });
    onUpdate();
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    toast({ title: "Link copied!" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Share2 className="h-4 w-4" />
          Share trip
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Share a read-only view with travel companions. They won&apos;t need an account.
        </p>
        {trip.is_public && shareUrl ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{shareUrl}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-3 w-3" />
                Copy link
              </Button>
              <Button variant="outline" size="sm" onClick={disableSharing} disabled={loading}>
                Disable sharing
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={enableSharing} disabled={loading}>
            {loading ? "Enabling..." : "Enable share link"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
