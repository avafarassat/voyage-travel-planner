export function normalizeTripName(name: string): string {
  return name.trim().toLowerCase();
}

export function isDuplicateTripName(name: string, existingNames: string[]): boolean {
  const normalized = normalizeTripName(name);
  if (!normalized) return false;
  return existingNames.some((existing) => normalizeTripName(existing) === normalized);
}

export const DUPLICATE_TRIP_NAME_MESSAGE =
  "You already have a trip with this name. Please choose a different trip name.";
