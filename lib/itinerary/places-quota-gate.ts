/** Google Places response statuses that indicate quota / rate exhaustion. */
const QUOTA_EXHAUSTED_STATUSES = new Set([
  "OVER_QUERY_LIMIT",
  "RESOURCE_EXHAUSTED",
]);

export function isQuotaExhaustedStatus(status?: string): boolean {
  return status != null && QUOTA_EXHAUSTED_STATUSES.has(status);
}

export const QUOTA_EXHAUSTED_USER_MESSAGE =
  "Voyage could not complete the itinerary because Google Places quota was reached. Please try again later or increase your Places API quota.";

/**
 * Request-scoped gate: once quota is exhausted, skip further live Places fetches
 * for the remainder of this Generate (or other orchestrated) request.
 */
export class PlacesQuotaGate {
  private exhausted = false;
  private exhaustedAtContext?: string;
  private exhaustedStatus?: string;
  private totalSkips = 0;
  private skipByContext = new Map<string, number>();

  isQuotaExhausted(): boolean {
    return this.exhausted;
  }

  allowLiveFetch(): boolean {
    return !this.exhausted;
  }

  markQuotaExhausted(context?: string, status?: string): void {
    if (this.exhausted) return;
    this.exhausted = true;
    this.exhaustedAtContext = context;
    this.exhaustedStatus = status ?? "OVER_QUERY_LIMIT";
    console.warn("[itinerary-generate] quota_exhausted", {
      context: this.exhaustedAtContext,
      status: this.exhaustedStatus,
    });
  }

  /** Record a skipped fetch; logs `[itinerary-generate] quota_skip` once per context. */
  recordSkip(context: string): void {
    this.totalSkips++;
    const count = (this.skipByContext.get(context) ?? 0) + 1;
    this.skipByContext.set(context, count);
    if (count === 1) {
      console.info("[itinerary-generate] quota_skip", { context });
    }
  }

  logSummary(): void {
    if (!this.exhausted && this.totalSkips === 0) return;
    console.info("[itinerary-generate] quota_gate_summary", {
      exhausted: this.exhausted,
      exhaustedAtContext: this.exhaustedAtContext,
      exhaustedStatus: this.exhaustedStatus,
      totalSkips: this.totalSkips,
      skipByContext: Object.fromEntries(this.skipByContext),
    });
  }
}

export function createPlacesQuotaGate(): PlacesQuotaGate {
  return new PlacesQuotaGate();
}
