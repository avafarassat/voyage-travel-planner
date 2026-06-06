"use client";

import { cn } from "@/lib/utils";
import { TRIP_INTERESTS, MIN_INTERESTS, type TripInterest } from "@/lib/itinerary/interests";

interface ItineraryInterestsProps {
  selected: TripInterest[];
  onChange: (interests: TripInterest[]) => void;
}

export function ItineraryInterests({ selected, onChange }: ItineraryInterestsProps) {
  function toggle(id: TripInterest) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const canGenerate = selected.length >= MIN_INTERESTS;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="font-semibold">What are you most interested in doing?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick at least {MIN_INTERESTS} — we&apos;ll use these to fill your days with top-rated
          suggestions that match your vibe.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TRIP_INTERESTS.map((interest) => {
          const isSelected = selected.includes(interest.id);
          return (
            <button
              key={interest.id}
              type="button"
              onClick={() => toggle(interest.id)}
              className={cn(
                "flex flex-col items-start rounded-lg border p-3 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <span className="text-xl">{interest.emoji}</span>
              <span className="mt-1 text-sm font-medium">{interest.label}</span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{interest.description}</span>
            </button>
          );
        })}
      </div>
      <p
        className={cn(
          "text-xs",
          canGenerate ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
        )}
      >
        {canGenerate
          ? `${selected.length} selected — ready to generate`
          : `Select ${MIN_INTERESTS - selected.length} more to continue`}
      </p>
    </div>
  );
}

export { MIN_INTERESTS };
