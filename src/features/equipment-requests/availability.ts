/** Client-safe availability calculations for PTR-40. */

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

/** AC3: Show Technical Support the number of units missing, when units are short. */
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
 * Convert a date-time string to milliseconds since the UTC epoch.
 * Accept `Z` and offsets such as `+08:00`. Treat timestamps without an offset as UTC.
 */
export function parseUtcTimestamp(ts: string): number {
  if (ts.endsWith("Z") || /[+-]\d{2}(?::?\d{2})?$/.test(ts)) {
    return Date.parse(ts);
  }
  return Date.parse(`${ts.replace(" ", "T")}Z`);
}

/**
 * Return available units and peak reservations for the half-open window `[startsAt, endsAt)`.
 *
 * Serviceable capacity is `max(0, held - unavailable)`. Find the peak reservation count in the
 * window. Process end events before start events at a shared boundary, so back-to-back periods do
 * not overlap. Skip malformed or non-positive entries. An invalid window returns zero units and no
 * peak. Keep the observed peak when it exceeds capacity. Do not calculate it from clamped availability.
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
