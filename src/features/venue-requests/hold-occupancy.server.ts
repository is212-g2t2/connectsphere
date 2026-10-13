import { sql } from "drizzle-orm";

import { venueHolds } from "#/db/schema";

/**
 * The occupied period of a hold: the requested times extended by the buffers stored on the hold.
 * `loadVenueHolds` reads it, and the event list's hold-conflict read compares it. These readers
 * use the source tables until PTR-135 moves them to `venue_occupancy`.
 */
export function holdOccupancy() {
  return {
    occupiedStart: sql`${venueHolds.startsAt} - make_interval(mins => ${venueHolds.setupMinutes})`,
    occupiedEnd: sql`${venueHolds.endsAt} + make_interval(mins => ${venueHolds.turnaroundMinutes})`,
  };
}
