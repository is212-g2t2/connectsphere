/** Pure arithmetic for PTR-40; client-safe, so no server import belongs here. */

export function summariseAvailability({
  held,
  reserved,
  unavailable,
  requested,
}: {
  held: number;
  reserved: number;
  unavailable: number;
  requested?: number;
}) {
  const available = Math.max(0, held - reserved - unavailable);
  const count = requested ?? 0;
  return {
    held,
    reserved,
    unavailable,
    available,
    requested: count,
    shortfall: Math.max(0, count - available),
  };
}

/** AC3: the words shown to Technical Support, stating the shortfall when there is one. */
export function availabilityMessage(result: {
  available: number;
  shortfall: number;
  requested: number;
}): string {
  return result.shortfall > 0
    ? `Short by ${result.shortfall}: ${result.available} available, ${result.requested} requested`
    : `${result.available} available`;
}
