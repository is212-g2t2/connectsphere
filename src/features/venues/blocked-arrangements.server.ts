import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  eventRequests,
  venueHolds,
  venueOccupancy,
  venueRequests,
  venueUnavailability,
  venues,
} from "#/db/schema";
import type { BlockedArrangement } from "#/features/events/access";

/**
 * Keep this module server-only: `#/db/schema` is a value import. The event list, the coordination
 * list and the Coordinator's release read the ledger through the one predicate below.
 */

type Database = typeof Db;

/** The statuses that no longer plan: the flag and the list skip an event in one of them. */
const CLOSED_STATUSES = ["cancelled", "completed"] as const;

/**
 * A suspended piece is a booking or hold ledger row that a live block deactivated (ADR-7). A
 * block's own row is never one. With `eventIdOrColumn`, the rows of that event alone.
 */
export function suspendedPieceWhere(eventIdOrColumn?: AnyColumn | SQL | number): SQL {
  const suspended = sql`${venueOccupancy.active} = false and ${venueOccupancy.venueUnavailabilityId} is null`;
  return eventIdOrColumn === undefined
    ? suspended
    : sql`${suspended} and ${venueOccupancy.eventId} = ${eventIdOrColumn}`;
}

/**
 * The coordination list's flag: the event has a suspended piece and still plans. `eventIdColumn`
 * and `statusColumn` are the listed event's columns; a cancelled or completed event is never
 * flagged, as the loader never lists one.
 */
export function hasBlockedArrangementSql(
  eventIdColumn: AnyColumn,
  statusColumn: AnyColumn
): SQL<boolean> {
  return sql<boolean>`${statusColumn} not in (${sql.join(
    CLOSED_STATUSES.map(status => sql`${status}`),
    sql`, `
  )}) and exists (select 1 from ${venueOccupancy} where ${suspendedPieceWhere(eventIdColumn)})`.mapWith(
    Boolean
  );
}

/**
 * PTR-137 AC1, AC4: list each event's bookings and holds that a live block suspends, with the
 * block's reason and period. Read the ledger: the live block that contains a suspended piece is
 * the one that suspended it (ADR-7). List a booking that a block split once. A lift restores or
 * deletes the pieces, so the flag clears with it and nothing is stored here.
 *
 * Skip cancelled and completed events: their state no longer concerns a block.
 */
export async function loadBlockedArrangements(
  database: Pick<Database, "select">,
  eventIds: readonly number[]
): Promise<Map<number, BlockedArrangement[]>> {
  const blocked = new Map<number, BlockedArrangement[]>();
  if (eventIds.length === 0) return blocked;

  const rows = await database
    .select({
      eventId: venueOccupancy.eventId,
      venueRequestId: venueOccupancy.venueRequestId,
      venueHoldId: venueOccupancy.venueHoldId,
      venueName: venues.name,
      bookingStartsAt: venueRequests.startsAt,
      bookingEndsAt: venueRequests.endsAt,
      bookingStatus: venueRequests.status,
      holdStartsAt: venueHolds.startsAt,
      holdEndsAt: venueHolds.endsAt,
      holdStatus: venueHolds.status,
      blockReason: venueUnavailability.reason,
      blockStartsAt: venueUnavailability.startsAt,
      blockEndsAt: venueUnavailability.endsAt,
    })
    .from(venueOccupancy)
    .innerJoin(venues, eq(venues.id, venueOccupancy.venueId))
    .innerJoin(
      eventRequests,
      and(
        eq(eventRequests.id, venueOccupancy.eventId),
        notInArray(eventRequests.status, [...CLOSED_STATUSES])
      )
    )
    .innerJoin(
      venueUnavailability,
      and(
        eq(venueUnavailability.venueId, venueOccupancy.venueId),
        isNull(venueUnavailability.liftedAt),
        sql`tsrange(${venueUnavailability.startsAt}, ${venueUnavailability.endsAt}, '[)') @> tsrange(${venueOccupancy.startsAt}, ${venueOccupancy.endsAt}, '[)')`
      )
    )
    .leftJoin(venueRequests, eq(venueRequests.id, venueOccupancy.venueRequestId))
    .leftJoin(venueHolds, eq(venueHolds.id, venueOccupancy.venueHoldId))
    .where(and(inArray(venueOccupancy.eventId, [...eventIds]), suspendedPieceWhere()))
    .orderBy(venueOccupancy.eventId, venueOccupancy.startsAt, venueOccupancy.id);

  const seen = new Set<string>();
  for (const row of rows) {
    if (row.eventId === null) continue;
    const block = { reason: row.blockReason, startsAt: row.blockStartsAt, endsAt: row.blockEndsAt };
    let arrangement: BlockedArrangement | null = null;
    if (
      row.venueRequestId !== null &&
      row.bookingStatus === "approved" &&
      row.bookingStartsAt !== null &&
      row.bookingEndsAt !== null
    ) {
      arrangement = {
        kind: "booking",
        id: row.venueRequestId,
        venueName: row.venueName,
        startsAt: row.bookingStartsAt,
        endsAt: row.bookingEndsAt,
        block,
      };
    } else if (
      row.venueHoldId !== null &&
      row.holdStatus === "held" &&
      row.holdStartsAt !== null &&
      row.holdEndsAt !== null
    ) {
      arrangement = {
        kind: "hold",
        id: row.venueHoldId,
        venueName: row.venueName,
        startsAt: row.holdStartsAt,
        endsAt: row.holdEndsAt,
        block,
      };
    }
    if (!arrangement) continue;
    const key = `${arrangement.kind}:${arrangement.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = blocked.get(row.eventId) ?? [];
    list.push(arrangement);
    blocked.set(row.eventId, list);
  }
  return blocked;
}
