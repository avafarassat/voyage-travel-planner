"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg sm:left-auto">
      <div>
        <p className="font-medium">Install Voyage</p>
        <p className="text-xs text-muted-foreground">Add to your home screen for quick access</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleInstall}>
          <Download className="h-3 w-3" />
          Install
        </Button>
        <Button size="icon" variant="ghost" onClick={() => setDismissed(true)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
