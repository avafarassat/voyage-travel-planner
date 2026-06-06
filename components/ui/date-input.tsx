"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y}`;
}

function parseDisplay(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;

  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  const y = parseInt(parts[2], 10);

  if (Number.isNaN(m) || Number.isNaN(d) || Number.isNaN(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000) return null;

  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(iso + "T12:00:00");
  if (
    parsed.getFullYear() !== y ||
    parsed.getMonth() + 1 !== m ||
    parsed.getDate() !== d
  ) {
    return null;
  }

  return iso;
}

interface DateInputProps {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
}

export function DateInput({
  id,
  value,
  onChange,
  min,
  max,
  required,
  className,
}: DateInputProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => isoToDisplay(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(isoToDisplay(value));
    setError(null);
  }, [value]);

  function applyIso(iso: string) {
    onChange(iso);
    setText(isoToDisplay(iso));
    setError(null);
  }

  function handleBlur() {
    if (!text.trim()) {
      setError(null);
      onChange("");
      return;
    }

    const iso = parseDisplay(text);
    if (!iso) {
      setError("Use MM/DD/YYYY");
      return;
    }
    if (min && iso < min) {
      setError(`Must be on or after ${isoToDisplay(min)}`);
      return;
    }
    if (max && iso > max) {
      setError(`Must be on or before ${isoToDisplay(max)}`);
      return;
    }

    applyIso(iso);
  }

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
    } else {
      picker.focus();
      picker.click();
    }
  }

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="MM/DD/YYYY"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={handleBlur}
          required={required}
          aria-invalid={!!error}
          className={cn("pr-10", error && "border-destructive", className)}
        />
        <button
          type="button"
          onClick={openPicker}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Open calendar"
        >
          <Calendar className="h-4 w-4" />
        </button>
        {/* Native picker — synced with text field, opened via calendar button */}
        <input
          ref={pickerRef}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => applyIso(e.target.value)}
          className="pointer-events-none absolute bottom-0 right-2 h-0 w-0 opacity-0"
          tabIndex={-1}
          aria-hidden
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
