import { PLACE_CATEGORIES } from "@/lib/types";
import { legendPinSvg } from "@/lib/map/pin-icons";

interface MapLegendProps {
  hasHotel: boolean;
}

function LegendItem({
  color,
  category,
  label,
}: {
  color: string;
  category?: Parameters<typeof legendPinSvg>[1];
  label: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        className="h-4 w-3 shrink-0 bg-center bg-no-repeat"
        style={{
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(legendPinSvg(color, category))}")`,
          backgroundSize: "contain",
        }}
        aria-hidden
      />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </li>
  );
}

export function MapLegend({ hasHotel }: MapLegendProps) {
  return (
    <div
      className="shrink-0 border-t bg-muted/40 px-3 py-2"
      aria-label="Map legend"
    >
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <li className="w-full text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:w-auto sm:mr-1">
          Map key
        </li>
        {hasHotel && (
          <LegendItem color="#7C3AED" label="Hotel" />
        )}
        {PLACE_CATEGORIES.map(({ value, label, color }) => (
          <LegendItem key={value} color={color} category={value} label={label} />
        ))}
      </ul>
    </div>
  );
}
