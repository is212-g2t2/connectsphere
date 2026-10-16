import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

import { eventRequests, venueHolds, venueOccupancy, venueRequests } from "#/db/schema";
import { ConflictError } from "#/features/auth/session";
import {
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  venueBlockConflictMessage,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";
import type { VenueTx } from "#/features/venue-requests/venue-lock.server";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * PTR-134: the writers' side of the venue occupancy ledger (ADR-7). Approval, amendment, release,
 * and hold create, release and convert call these functions inside their advisory-locked
 * transactions, so a ledger row and its source record commit or roll back together. The block
 * recorder and lift use the block suspend/restore helpers below.
 */

const log = logger.getChild("venue-occupancy");

/** A commitment's venue, event and requested period, with the buffers to store on its row. */
interface Occupancy {
  venueId: number;
  eventId: number | null;
  startsAt: string;
  endsAt: string | null;
  setupMinutes: number;
  turnaroundMinutes: number;
}

type OccupancySource =
  | { venueRequestId: string }
  | { venueHoldId: string }
  | { venueUnavailabilityId: number };

/**
 * node-postgres puts the SQLSTATE in `code`. Bun SQL puts it in `errno` and sets `code` to
 * `ERR_POSTGRES_SERVER_ERROR`. Drizzle wraps both driver errors in `cause`.
 */
export function isDeadlock(error: unknown): boolean {
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

/** Match the ledger rows that the source owns. */
function ownedBy(source: OccupancySource): SQL {
  if ("venueRequestId" in source) return eq(venueOccupancy.venueRequestId, source.venueRequestId);
  if ("venueHoldId" in source) return eq(venueOccupancy.venueHoldId, source.venueHoldId);
  return eq(venueOccupancy.venueUnavailabilityId, source.venueUnavailabilityId);
}

/**
 * Delete every ledger row of the source, split pieces included. A writer that changes a
 * commitment deletes its rows and writes new ones. Only block suspend and restore change `active`
 * in place.
 */
export async function vacateVenue(tx: VenueTx, source: OccupancySource): Promise<void> {
  await tx.delete(venueOccupancy).where(ownedBy(source));
}

/**
 * A ledger row's occupied period: its times extended by the buffers stored on it. Keep these
 * expressions identical to the constraint's, so the GiST index serves the overlap.
 */
const occupiedStart = sql`${venueOccupancy.startsAt} - make_interval(mins => ${venueOccupancy.setupMinutes})`;
const occupiedEnd = sql`${venueOccupancy.endsAt} + make_interval(mins => ${venueOccupancy.turnaroundMinutes})`;

/** A ledger row that a hold owns. */
export const isHoldRow = sql<boolean>`${venueOccupancy.venueHoldId} is not null`;

/** A ledger row that a venue block owns. */
export const isBlockRow = sql<boolean>`${venueOccupancy.venueUnavailabilityId} is not null`;

/** A period to compare with the ledger: its venue, its times, and the buffers around them. */
interface BufferedPeriod {
  venueId: SQLWrapper | number;
  startsAt: SQLWrapper | string;
  endsAt: SQLWrapper | string;
  setupMinutes: SQLWrapper | number;
  turnaroundMinutes: SQLWrapper | number;
}

/**
 * Match the ledger rows at the period's venue, active or not, that overlap the period once the
 * buffers count on both sides. Pass columns or values.
 */
export function overlapsPeriod(period: BufferedPeriod): SQL {
  const requestedStart = sql`${period.startsAt}::timestamp - make_interval(mins => ${period.setupMinutes}::integer)`;
  const requestedEnd = sql`${period.endsAt}::timestamp + make_interval(mins => ${period.turnaroundMinutes}::integer)`;
  return sql`${venueOccupancy.venueId} = ${period.venueId} and tsrange(${occupiedStart}, ${occupiedEnd}, '[)') && tsrange(${requestedStart}, ${requestedEnd}, '[)')`;
}

/**
 * ADR-7: match the active ledger rows at the period's venue that overlap the period once the
 * buffers count on both sides. Approval, the same-event overlap rule and the conflict flag share
 * this one test, so the flag and the refusals agree. Pass columns or values.
 */
export function overlapsLedger(period: BufferedPeriod): SQL {
  return sql`${venueOccupancy.active} and ${overlapsPeriod(period)}`;
}

/**
 * Refuse a commitment that would overlap an active ledger row at the venue once the buffers count.
 * Name the venue and the other row's occupied period, never the other event. Name a block before
 * a booking before a hold (ADR-8), then the earliest. Return the row to write, with the venue's
 * current buffers.
 *
 * Pass the venue that `loadLockedVenue` read under the venue lock. A venue save and the other
 * writers take the same lock, so the buffers and the rows stay current. The constraint refuses a
 * writer outside the lock.
 */
export async function checkVenueFree(
  tx: VenueTx,
  venue: { id: number; name: string; setupMinutes: number; turnaroundMinutes: number },
  commitment: { eventId: number; startsAt: string; endsAt: string }
): Promise<Occupancy & { eventId: number; endsAt: string }> {
  const occupancy = {
    venueId: venue.id,
    eventId: commitment.eventId,
    startsAt: commitment.startsAt,
    endsAt: commitment.endsAt,
    setupMinutes: venue.setupMinutes,
    turnaroundMinutes: venue.turnaroundMinutes,
  };

  const kindRank = sql<number>`case when ${isBlockRow} then 0 when ${isHoldRow} then 2 else 1 end`;
  const rows = await tx
    .select({
      isBlock: isBlockRow,
      isHold: isHoldRow,
      // Bound the named period to the calendar's civil years, as `loadVenueHolds` does.
      startsAt: sql<string>`greatest(${occupiedStart}, timestamp '0001-01-01 00:00:00')::text`,
      endsAt: sql<string>`least(${occupiedEnd}, timestamp '9999-12-31 23:59:59')::text`,
      // A block row with a null end is open-ended. Give the block message the null, not the
      // `least` bound.
      blockEndsAt: venueOccupancy.endsAt,
    })
    .from(venueOccupancy)
    .where(overlapsLedger(occupancy))
    .orderBy(kindRank, asc(occupiedStart))
    .limit(1);
  const conflict = rows.at(0);
  if (!conflict) return occupancy;

  const venueName = venue.name;
  if (conflict.isBlock) {
    throw new ConflictError(
      venueBlockConflictMessage({
        venueName,
        startsAt: conflict.startsAt,
        endsAt: conflict.blockEndsAt,
      })
    );
  }
  const message = conflict.isHold ? venueHoldConflictMessage : venueRequestConflictMessage;
  throw new ConflictError(
    message({ venueName, startsAt: conflict.startsAt, endsAt: conflict.endsAt })
  );
}

/**
 * The block period a suspend/restore helper reads or writes. A null end is unbounded. Stamps use
 * the database `YYYY-MM-DD HH:MM:SS` shape, which compares as a date.
 */
interface BlockExtent {
  venueId: number;
  startsAt: string;
  endsAt: string | null;
}

/** What a block does to an occupied extent that it overlaps: a full suspend, or a split. */
type BlockOutcome =
  | { kind: "deactivate" }
  | { kind: "split"; pieces: { startsAt: string; endsAt: string; active: boolean }[] };

/**
 * Pure cut of an occupied extent that overlaps the block. Fixed-width stamps compare as dates.
 * Fully inside -> deactivate; else split into the intersection (inactive) plus the left and right
 * remainders (active). The overlap makes each piece non-empty.
 */
function blockOutcome(
  occupied: { startsAt: string; endsAt: string },
  block: BlockExtent
): BlockOutcome {
  const cutsStart = occupied.startsAt < block.startsAt;
  const blockEnd = block.endsAt;
  const cutsEnd = blockEnd !== null && blockEnd < occupied.endsAt;
  if (!cutsStart && !cutsEnd) return { kind: "deactivate" };
  const pieces = [
    {
      startsAt: cutsStart ? block.startsAt : occupied.startsAt,
      endsAt: cutsEnd ? blockEnd : occupied.endsAt,
      active: false,
    },
  ];
  if (cutsStart) pieces.push({ startsAt: occupied.startsAt, endsAt: block.startsAt, active: true });
  if (cutsEnd) pieces.push({ startsAt: blockEnd, endsAt: occupied.endsAt, active: true });
  return { kind: "split", pieces };
}

/**
 * Read the non-block rows at the block's venue that `match` selects. Each row carries its occupied
 * period, its event, the possible notice recipients, and its source's status and own times. A
 * plain read with no row locks: the caller key-shares the events before it writes.
 */
function selectBlockCommitments(tx: VenueTx, block: BlockExtent, match: SQL) {
  return tx
    .select({
      id: venueOccupancy.id,
      venueId: venueOccupancy.venueId,
      eventId: eventRequests.id,
      venueRequestId: venueOccupancy.venueRequestId,
      venueHoldId: venueOccupancy.venueHoldId,
      occupiedStart: sql<string>`(${occupiedStart})::text`,
      occupiedEnd: sql<string>`(${occupiedEnd})::text`,
      eventName: eventRequests.eventName,
      eventStatus: eventRequests.status,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      requestedById: venueRequests.requestedById,
      heldById: venueHolds.heldById,
      bookingStatus: venueRequests.status,
      holdStatus: venueHolds.status,
      // Exactly one source joins, so `coalesce` gives that source's own times.
      sourceStartsAt: sql<string>`coalesce(${venueRequests.startsAt}, ${venueHolds.startsAt})::text`,
      sourceEndsAt: sql<string>`coalesce(${venueRequests.endsAt}, ${venueHolds.endsAt})::text`,
    })
    .from(venueOccupancy)
    .innerJoin(eventRequests, eq(eventRequests.id, venueOccupancy.eventId))
    .leftJoin(venueRequests, eq(venueRequests.id, venueOccupancy.venueRequestId))
    .leftJoin(venueHolds, eq(venueHolds.id, venueOccupancy.venueHoldId))
    .where(
      and(
        eq(venueOccupancy.venueId, block.venueId),
        isNull(venueOccupancy.venueUnavailabilityId),
        match
      )
    );
}

/** The block's period as a range. A null end is unbounded. */
function blockRange(block: BlockExtent): SQL {
  return sql`tsrange(${block.startsAt}::timestamp, ${block.endsAt}::timestamp, '[)')`;
}

/** Read the active non-block rows whose occupied period overlaps the block. */
export async function loadBlockCommitments(tx: VenueTx, block: BlockExtent) {
  return selectBlockCommitments(
    tx,
    block,
    sql`${venueOccupancy.active} and tsrange(${occupiedStart}, ${occupiedEnd}, '[)') && ${blockRange(block)}`
  );
}

/** One non-block ledger row that a block covers or suspended. */
export type BlockCommitment = Awaited<ReturnType<typeof loadBlockCommitments>>[number];

/**
 * Suspend each commitment that `loadBlockCommitments` read for the block. A fully covered row
 * flips to inactive and keeps its stored buffers. A partial cover deletes the row, then inserts
 * the intersection inactive and the remainders active, each with the occupied extent and buffers
 * 0. Never touches block rows. Deletes before inserts so a piece never overlaps its active source,
 * and the caller inserts the block's own row after this returns.
 */
export async function suspendBlockCommitments(
  tx: VenueTx,
  block: BlockExtent,
  rows: readonly BlockCommitment[]
): Promise<void> {
  for (const row of rows) {
    const outcome = blockOutcome({ startsAt: row.occupiedStart, endsAt: row.occupiedEnd }, block);
    if (outcome.kind === "deactivate") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- suspend rows in read order
      await tx.update(venueOccupancy).set({ active: false }).where(eq(venueOccupancy.id, row.id));
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- delete before inserting pieces
    await tx.delete(venueOccupancy).where(eq(venueOccupancy.id, row.id));
    for (const piece of outcome.pieces) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- insert pieces after the delete
      await tx
        .insert(venueOccupancy)
        .values({
          venueId: row.venueId,
          eventId: row.eventId,
          venueRequestId: row.venueRequestId,
          venueHoldId: row.venueHoldId,
          startsAt: piece.startsAt,
          endsAt: piece.endsAt,
          setupMinutes: 0,
          turnaroundMinutes: 0,
          active: piece.active,
        })
        .catch(rethrowVenueConflict);
    }
  }
}

/** Read the inactive non-block rows whose occupied period sits inside the block. */
export async function loadRestorableCommitments(tx: VenueTx, block: BlockExtent) {
  return selectBlockCommitments(
    tx,
    block,
    sql`not ${venueOccupancy.active} and tsrange(${occupiedStart}, ${occupiedEnd}, '[)') <@ ${blockRange(block)}`
  );
}

/** The source that owns a commitment row. Every non-block row has a request or a hold. */
function sourceOf(row: BlockCommitment): { venueRequestId: string } | { venueHoldId: string } {
  if (row.venueRequestId !== null) return { venueRequestId: row.venueRequestId };
  if (row.venueHoldId !== null) return { venueHoldId: row.venueHoldId };
  throw new Error(`Ledger row ${row.id} has no request or hold`);
}

/**
 * Replace a split source's pieces with one row when all of them are active again. The pieces
 * cover the source's occupied period without gaps. The new row takes the source's own times, and
 * buffers that reach from those times to the first and the last piece.
 */
async function collapsePieces(
  tx: VenueTx,
  row: BlockCommitment,
  source: { venueRequestId: string } | { venueHoldId: string }
): Promise<void> {
  const [pieces] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      allActive: sql<boolean>`bool_and(${venueOccupancy.active})`,
      setupMinutes: sql<number>`(extract(epoch from ${row.sourceStartsAt}::timestamp - min(${occupiedStart})) / 60)::int`,
      turnaroundMinutes: sql<number>`(extract(epoch from max(${occupiedEnd}) - ${row.sourceEndsAt}::timestamp) / 60)::int`,
    })
    .from(venueOccupancy)
    .where(ownedBy(source));
  if (pieces.count < 2 || !pieces.allActive) return;
  await vacateVenue(tx, source);
  await occupyVenue(tx, {
    venueId: row.venueId,
    eventId: row.eventId,
    startsAt: row.sourceStartsAt,
    endsAt: row.sourceEndsAt,
    setupMinutes: pieces.setupMinutes,
    turnaroundMinutes: pieces.turnaroundMinutes,
    ...source,
  });
}

/**
 * Restore each suspended row whose source is still live, and delete the rest. A booking counts
 * as live when approved, a hold when held. The app writers already delete replaced rows, so a
 * dead source here is defensive. Then give each restored source that a block split one row
 * again (`collapsePieces`). Never touches block rows. Returns the rows it re-activated. The
 * caller deletes the block's own row before this runs.
 */
export async function restoreBlockCommitments(
  tx: VenueTx,
  rows: readonly BlockCommitment[]
): Promise<BlockCommitment[]> {
  const restored: BlockCommitment[] = [];
  for (const row of rows) {
    if (row.bookingStatus === "approved" || row.holdStatus === "held") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- restore rows in read order
      await tx.update(venueOccupancy).set({ active: true }).where(eq(venueOccupancy.id, row.id));
      restored.push(row);
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- drop rows whose source is gone
      await tx.delete(venueOccupancy).where(eq(venueOccupancy.id, row.id));
    }
  }
  const sources = new Map(
    restored.map(row => [row.venueRequestId ?? row.venueHoldId, { row, source: sourceOf(row) }])
  );
  for (const { row, source } of sources.values()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- collapse after every restore
    await collapsePieces(tx, row, source);
  }
  return restored;
}
