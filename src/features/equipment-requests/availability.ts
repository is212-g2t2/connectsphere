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

/**
 * Parses a date-time string into milliseconds since epoch UTC.
 * Safely handles strings already containing timezone designators ('Z' or offsets like '+08:00'),
 * as well as bare ISO/SQL timestamps needing UTC assumption.
 */
export function parseUtcTimestamp(ts: string): number {
  if (ts.endsWith("Z") || /[+-]\d{2}(?::?\d{2})?$/.test(ts)) {
    return Date.parse(ts);
  }
  return Date.parse(`${ts.replace(" ", "T")}Z`);
}

/**
 * Available units of a type over the target half-open window [startsAt, endsAt), plus the peak
 * concurrent reservation the sweep saw.
 *
 * Net serviceable capacity is max(0, held - unavailable); a discrete event sweep finds the peak
 * concurrent reservation clamped to the window, with end-events ordered before start-events on
 * touching boundaries so back-to-back periods do not stack. Malformed or non-positive entries
 * are skipped; an invalid window yields 0 available with no peak. The peak is the true observed
 * maximum even when overbooked past capacity, so callers never derive it from the clamped
 * available count.
 */
export function computeAvailableEquipmentQuantity(
  quantityHeld: number,
  quantityUnavailable: number,
  targetWindow: { startsAt: string; endsAt: string },
  overlappingReservations: Array<{ startsAt: string; endsAt: string; quantity: number }>
): { availableQuantity: number; peakReserved: number } {
  const totalServiceable = Math.max(0, quantityHeld - quantityUnavailable);
  const targetStart = parseUtcTimestamp(targetWindow.startsAt);
  const targetEnd = parseUtcTimestamp(targetWindow.endsAt);

  if (Number.isNaN(targetStart) || Number.isNaN(targetEnd) || targetEnd <= targetStart) {
    return { availableQuantity: 0, peakReserved: 0 };
  }

  const events: Array<{ time: number; delta: number }> = [];

  for (const res of overlappingReservations) {
    if (res.quantity <= 0) continue;

    const resStart = parseUtcTimestamp(res.startsAt);
    const resEnd = parseUtcTimestamp(res.endsAt);

    if (Number.isNaN(resStart) || Number.isNaN(resEnd) || resEnd <= resStart) continue;

    const activeStart = Math.max(targetStart, resStart);
    const activeEnd = Math.min(targetEnd, resEnd);

    if (activeEnd > activeStart) {
      events.push({ time: activeStart, delta: res.quantity });
      events.push({ time: activeEnd, delta: -res.quantity });
    }
  }

  events.sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.delta - b.delta;
  });

  let currentReserved = 0;
  let peakReserved = 0;

  for (const event of events) {
    currentReserved += event.delta;
    if (currentReserved > peakReserved) {
      peakReserved = currentReserved;
    }
  }

  return {
    availableQuantity: Math.max(0, totalServiceable - peakReserved),
    peakReserved,
  };
}
