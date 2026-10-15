import { asc, eq, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

import { venueOccupancy } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import {
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * PTR-134: the writers' side of the venue occupancy ledger (ADR-7). Approval, amendment, release,
 * and hold create, release and convert call these functions inside their advisory-locked
 * transactions, so a ledger row and its source record commit or roll back together.
 */

const log = logger.getChild("venue-occupancy");

/** A commitment's venue, event and requested period, with the buffers to store on its row. */
interface Occupancy {
  venueId: number;
  eventId: number;
  startsAt: string;
  endsAt: string;
  setupMinutes: number;
  turnaroundMinutes: number;
}

type OccupancySource = { venueRequestId: string } | { venueHoldId: string };

/**
 * node-postgres puts the SQLSTATE in `code`. Bun SQL puts it in `errno` and sets `code` to
 * `ERR_POSTGRES_SERVER_ERROR`. Drizzle wraps both driver errors in `cause`.
 */
function isDeadlock(error: unknown): boolean {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null) {
    return false;
  }
  const cause = error.cause as { code?: unknown; errno?: unknown };
  return cause.code === "40P01" || cause.errno === "40P01";
}

/**
 * Map a refused ledger insert to the venue-conflict refusal. Two concurrent inserts of overlapping
 * rows can deadlock in the exclusion check, so 40P01 means a conflict here too. Every app writer
 * holds the venue lock, so only a writer outside that convention causes either error.
 */
export function rethrowVenueConflict(error: unknown): never {
  if (isConstraintViolation(error, "venue_occupancy_no_overlap")) {
    throw new ConflictError(VENUE_OCCUPANCY_CONFLICT_MESSAGE);
  }
  if (isDeadlock(error)) {
    log.warn("Refused an occupancy write that deadlocked", { sqlstate: "40P01" });
    throw new ConflictError(VENUE_OCCUPANCY_CONFLICT_MESSAGE);
  }
  throw error;
}

/** Write the source's ledger row. The constraint refuses an overlap with another active row. */
export async function occupyVenue(
  tx: VenueTx,
  occupancy: Occupancy & OccupancySource
): Promise<void> {
  await tx.insert(venueOccupancy).values(occupancy).catch(rethrowVenueConflict);
}

/** Delete every ledger row of the source. Writers never edit a row in place. */
export async function vacateVenue(tx: VenueTx, source: OccupancySource): Promise<void> {
  await tx
    .delete(venueOccupancy)
    .where(
      "venueRequestId" in source
        ? eq(venueOccupancy.venueRequestId, source.venueRequestId)
        : eq(venueOccupancy.venueHoldId, source.venueHoldId)
    );
}

/**
 * A ledger row's occupied period: its times extended by the buffers stored on it. Keep these
 * expressions identical to the constraint's, so the GiST index serves the overlap.
 */
const occupiedStart = sql`${venueOccupancy.startsAt} - make_interval(mins => ${venueOccupancy.setupMinutes})`;
const occupiedEnd = sql`${venueOccupancy.endsAt} + make_interval(mins => ${venueOccupancy.turnaroundMinutes})`;

/** A ledger row that a hold owns. */
export const isHoldRow = sql<boolean>`${venueOccupancy.venueHoldId} is not null`;

/** A period to compare with the ledger: its venue, its times, and the buffers around them. */
interface BufferedPeriod {
  venueId: SQLWrapper | number;
  startsAt: SQLWrapper | string;
  endsAt: SQLWrapper | string;
  setupMinutes: SQLWrapper | number;
  turnaroundMinutes: SQLWrapper | number;
}

/**
 * ADR-7: match the active ledger rows at the period's venue that overlap the period once the
 * buffers count on both sides. Approval, the same-event overlap rule and the conflict flag share
 * this one test, so the flag and the refusals agree. Pass columns or values.
 */
export function overlapsLedger(period: BufferedPeriod): SQL {
  const requestedStart = sql`${period.startsAt}::timestamp - make_interval(mins => ${period.setupMinutes}::integer)`;
  const requestedEnd = sql`${period.endsAt}::timestamp + make_interval(mins => ${period.turnaroundMinutes}::integer)`;
  return sql`${venueOccupancy.venueId} = ${period.venueId} and ${venueOccupancy.active} and tsrange(${occupiedStart}, ${occupiedEnd}, '[)') && tsrange(${requestedStart}, ${requestedEnd}, '[)')`;
}

/**
 * Refuse a commitment that would overlap an active ledger row at the venue. Name the venue and the
 * other row's occupied period, a booking before a hold, then the earliest. Do not name the other
 * event. Return the row to write, with the venue's current buffers.
 *
 * Pass the venue that `loadLockedVenue` read under the venue lock. A venue save and the other
 * writers take the same lock, so the buffers and the rows stay current. The constraint refuses a
 * writer outside the lock.
 */
export async function checkVenueFree(
  tx: VenueTx,
  venue: { id: number; name: string; setupMinutes: number; turnaroundMinutes: number },
  commitment: Pick<Occupancy, "eventId" | "startsAt" | "endsAt">
): Promise<Occupancy> {
  const occupancy = {
    venueId: venue.id,
    eventId: commitment.eventId,
    startsAt: commitment.startsAt,
    endsAt: commitment.endsAt,
    setupMinutes: venue.setupMinutes,
    turnaroundMinutes: venue.turnaroundMinutes,
  };

  const rows = await tx
    .select({
      isHold: isHoldRow,
      // Bound the named period to the calendar's civil years, as `loadVenueHolds` does.
      startsAt: sql<string>`greatest(${occupiedStart}, timestamp '0001-01-01 00:00:00')::text`,
      endsAt: sql<string>`least(${occupiedEnd}, timestamp '9999-12-31 23:59:59')::text`,
    })
    .from(venueOccupancy)
    .where(overlapsLedger(occupancy))
    .orderBy(isHoldRow, asc(occupiedStart))
    .limit(1);
  const conflict = rows.at(0);
  if (!conflict) return occupancy;

  const message = conflict.isHold ? venueHoldConflictMessage : venueRequestConflictMessage;
  throw new ConflictError(
    message({ venueName: venue.name, startsAt: conflict.startsAt, endsAt: conflict.endsAt })
  );
}
