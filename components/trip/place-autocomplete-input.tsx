"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { PlaceCategory } from "@/lib/types";

export interface AutocompleteSelection {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
  category?: PlaceCategory;
  photoUrl?: string;
}

interface PlaceAutocompleteInputProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (selection: AutocompleteSelection) => void;
  city?: string;
  country?: string | null;
  type?: "lodging" | "establishment" | "destination";
  placeholder?: string;
  required?: boolean;
  /** When set, skips `/api/places/autocomplete` and uses local results (user-initiated only). */
  mockSearch?: (query: string) => AutocompleteSelection[];
  formatSearchError?: (raw: string | null) => string;
}

export function PlaceAutocompleteInput({
  id,
  value,
  onValueChange,
  onSelect,
  city,
  country,
  type = "establishment",
  placeholder,
  required,
  mockSearch,
  formatSearchError,
}: PlaceAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<AutocompleteSelection[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipSearchRef = useRef(false);

  function updateMenuPosition() {
    const el = inputRef.current ?? containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }

  useEffect(() => {
    if (value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setError(null);
      return;
    }

    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);

      if (mockSearch) {
        const results = mockSearch(value);
        setSuggestions(results);
        setOpen(results.length > 0);
        if (results.length > 0) {
          updateMenuPosition();
          setError(null);
        } else {
          setError("No matches — try a different spelling");
        }
        setLoading(false);
        return;
      }

      const params = new URLSearchParams({
        query: value,
        type,
      });
      if (city) params.set("city", city);
      if (country) params.set("country", country);

      try {
        const res = await fetch(`/api/places/autocomplete?${params}`);
        const data = await res.json();

        if (!res.ok) {
          setSuggestions([]);
          setOpen(false);
          const rawError = data.error ?? "Search failed";
          setError(formatSearchError ? formatSearchError(rawError) : rawError);
          return;
        }

        const results = data.results ?? [];
        setSuggestions(results);
        setOpen(results.length > 0);
        if (results.length > 0) {
          updateMenuPosition();
        } else {
          setError("No matches — try a different spelling");
        }
      } catch {
        setSuggestions([]);
        setOpen(false);
        const rawError = "Could not search. Check your connection.";
        setError(formatSearchError ? formatSearchError(rawError) : rawError);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [value, city, country, type, mockSearch, formatSearchError]);

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, suggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-autocomplete-menu]")) {
          setOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const dropdown =
    open && suggestions.length > 0 ? (
      <ul
        data-autocomplete-menu
        className="fixed z-[9999] max-h-60 overflow-auto rounded-lg border bg-background shadow-lg"
        style={{
          top: menuStyle.top,
          left: menuStyle.left,
          width: menuStyle.width,
        }}
      >
        {suggestions.map((item) => (
          <li key={item.placeId ?? `${item.name}-${item.address}`}>
            <button
              type="button"
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                "border-b last:border-b-0"
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                skipSearchRef.current = true;
                onSelect(item);
                setSuggestions([]);
                setOpen(false);
                setError(null);
              }}
            >
              <span className="font-medium">{item.name}</span>
              {item.address && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {item.address}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) {
            updateMenuPosition();
            setOpen(true);
          }
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {loading && (
        <p className="mt-1 text-xs text-muted-foreground">Searching…</p>
      )}
      {!loading && error && value.length >= 2 && (
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
      )}
      {typeof document !== "undefined" && dropdown
        ? createPortal(dropdown, document.body)
        : null}
    </div>
  );
}
