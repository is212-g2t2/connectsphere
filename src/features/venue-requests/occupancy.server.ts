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
 * transactions, so a ledger row and its source record commit or roll back together.
 * PTR-136 adds block rows and the suspend/restore helpers below.
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

/** Delete every ledger row of the source. Writers never edit a row in place. */
export async function vacateVenue(tx: VenueTx, source: OccupancySource): Promise<void> {
  if ("venueRequestId" in source) {
    await tx.delete(venueOccupancy).where(eq(venueOccupancy.venueRequestId, source.venueRequestId));
  } else if ("venueHoldId" in source) {
    await tx.delete(venueOccupancy).where(eq(venueOccupancy.venueHoldId, source.venueHoldId));
  } else {
    await tx
      .delete(venueOccupancy)
      .where(eq(venueOccupancy.venueUnavailabilityId, source.venueUnavailabilityId));
  }
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

/** The block period a suspend/restore helper reads or writes. A null end is unbounded. Stamps use the database `YYYY-MM-DD HH:MM:SS` shape, which compares as a date. */
export interface BlockExtent {
  venueId: number;
  startsAt: string;
  endsAt: string | null;
}

/** A ledger row's stored period and buffers, without the venue and source ids. */
export interface LedgerValues {
  startsAt: string;
  endsAt: string;
  setupMinutes: number;
  turnaroundMinutes: number;
  active: boolean;
}

/** What one block does to one occupied extent: nothing, a full suspend, or a split. */
type BlockOutcome =
  | { kind: "clear" }
  | { kind: "deactivate" }
  | { kind: "split"; pieces: { startsAt: string; endsAt: string; active: boolean }[] };

/**
 * Pure overlap of an occupied extent against a block. Fixed-width stamps compare as dates.
 * No overlap -> clear; fully inside -> deactivate; else split into the non-empty
 * intersection (inactive) plus the left and right remainders (active).
 */
function blockOutcome(
  occupied: { startsAt: string; endsAt: string },
  block: BlockExtent
): BlockOutcome {
  const overlaps =
    block.endsAt === null
      ? block.startsAt < occupied.endsAt
      : occupied.startsAt < block.endsAt && block.startsAt < occupied.endsAt;
  if (!overlaps) return { kind: "clear" };
  if (
    occupied.startsAt >= block.startsAt &&
    (block.endsAt === null || occupied.endsAt <= block.endsAt)
  ) {
    return { kind: "deactivate" };
  }
  const intersectionStart =
    occupied.startsAt >= block.startsAt ? occupied.startsAt : block.startsAt;
  const intersectionEnd =
    block.endsAt === null
      ? occupied.endsAt
      : occupied.endsAt <= block.endsAt
        ? occupied.endsAt
        : block.endsAt;
  const pieces: { startsAt: string; endsAt: string; active: boolean }[] = [];
  if (intersectionStart < intersectionEnd) {
    pieces.push({ startsAt: intersectionStart, endsAt: intersectionEnd, active: false });
  }
  if (occupied.startsAt < block.startsAt) {
    pieces.push({ startsAt: occupied.startsAt, endsAt: block.startsAt, active: true });
  }
  if (block.endsAt !== null && block.endsAt < occupied.endsAt) {
    pieces.push({ startsAt: block.endsAt, endsAt: occupied.endsAt, active: true });
  }
  return { kind: "split", pieces };
}

/** Shift a `YYYY-MM-DD HH:MM:SS` stamp by minutes, staying in the same format. */
function shiftMinutes(value: string, minutes: number): string {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`) + minutes * 60_000;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Apply each block in turn to a growing value list, so the seed can write a covered booking
 * suspended without ever inserting an active row under a live block. Inactive values pass
 * through untouched. Deactivate keeps the stored buffers; split pieces use buffers 0.
 */
export function suspensionValues(
  row: LedgerValues,
  blocks: readonly BlockExtent[]
): LedgerValues[] {
  let values = [row];
  for (const block of blocks) {
    values = values.flatMap(value => {
      if (!value.active) return [value];
      const outcome = blockOutcome(
        {
          startsAt: shiftMinutes(value.startsAt, -value.setupMinutes),
          endsAt: shiftMinutes(value.endsAt, value.turnaroundMinutes),
        },
        block
      );
      if (outcome.kind === "clear") return [value];
      if (outcome.kind === "deactivate") return [{ ...value, active: false }];
      return outcome.pieces.map(piece => ({
        startsAt: piece.startsAt,
        endsAt: piece.endsAt,
        setupMinutes: 0,
        turnaroundMinutes: 0,
        active: piece.active,
      }));
    });
  }
  return values;
}

/**
 * Read the active non-block rows whose buffered occupied period overlaps the block extent.
 * Plain read with no row locks; the caller key-shares the events before any ledger row lock.
 * Never returns block rows. Joins the event inner (a non-block row always has one) and the
 * sources left, so the block writer can notify each commitment's owner.
 */
export async function loadBlockCommitments(tx: VenueTx, block: BlockExtent) {
  return tx
    .select({
      id: venueOccupancy.id,
      venueId: venueOccupancy.venueId,
      eventId: venueOccupancy.eventId,
      venueRequestId: venueOccupancy.venueRequestId,
      venueHoldId: venueOccupancy.venueHoldId,
      startsAt: venueOccupancy.startsAt,
      endsAt: venueOccupancy.endsAt,
      setupMinutes: venueOccupancy.setupMinutes,
      turnaroundMinutes: venueOccupancy.turnaroundMinutes,
      occupiedStart: sql<string>`(${occupiedStart})::text`,
      occupiedEnd: sql<string>`(${occupiedEnd})::text`,
      eventName: eventRequests.eventName,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      requestedById: venueRequests.requestedById,
      heldById: venueHolds.heldById,
    })
    .from(venueOccupancy)
    .innerJoin(eventRequests, eq(eventRequests.id, venueOccupancy.eventId))
    .leftJoin(venueRequests, eq(venueRequests.id, venueOccupancy.venueRequestId))
    .leftJoin(venueHolds, eq(venueHolds.id, venueOccupancy.venueHoldId))
    .where(
      and(
        eq(venueOccupancy.venueId, block.venueId),
        venueOccupancy.active,
        isNull(venueOccupancy.venueUnavailabilityId),
        sql`tsrange(${occupiedStart}, ${occupiedEnd}, '[)') && tsrange(${block.startsAt}::timestamp, ${block.endsAt}::timestamp, '[)')`
      )
    );
}

export type BlockCommitment = Awaited<ReturnType<typeof loadBlockCommitments>>[number];

/**
 * Suspend each overlapping commitment. A fully covered row flips to inactive and keeps its
 * stored buffers. A partial cover deletes the row, then inserts the intersection inactive and
 * the remainders active, each with the occupied extent and buffers 0. Skips zero-length pieces.
 * Never touches block rows. Deletes before inserts so a piece never overlaps its active source,
 * and the caller inserts the block's own row after this returns.
 */
export async function suspendBlockCommitments(
  tx: VenueTx,
  block: BlockExtent,
  rows: readonly BlockCommitment[]
): Promise<void> {
  for (const row of rows) {
    const outcome = blockOutcome({ startsAt: row.occupiedStart, endsAt: row.occupiedEnd }, block);
    if (outcome.kind === "clear") continue;
    if (outcome.kind === "deactivate") {
      // oxlint-disable-next-line eslint/no-await-in-loop -- suspend rows in read order
      await tx.update(venueOccupancy).set({ active: false }).where(eq(venueOccupancy.id, row.id));
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- delete before inserting pieces
    await tx.delete(venueOccupancy).where(eq(venueOccupancy.id, row.id));
    for (const piece of outcome.pieces) {
      if (piece.startsAt >= piece.endsAt) continue;
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

/**
 * Read the inactive non-block rows whose buffered occupied period sits inside the block extent.
 * Plain read with no row locks; the caller key-shares the events before any ledger row lock.
 * Never returns block rows. Carries each source's status so restore keeps only live rows.
 */
export async function loadRestorableCommitments(tx: VenueTx, block: BlockExtent) {
  return tx
    .select({
      id: venueOccupancy.id,
      venueId: venueOccupancy.venueId,
      eventId: venueOccupancy.eventId,
      venueRequestId: venueOccupancy.venueRequestId,
      venueHoldId: venueOccupancy.venueHoldId,
      startsAt: venueOccupancy.startsAt,
      endsAt: venueOccupancy.endsAt,
      setupMinutes: venueOccupancy.setupMinutes,
      turnaroundMinutes: venueOccupancy.turnaroundMinutes,
      occupiedStart: sql<string>`(${occupiedStart})::text`,
      occupiedEnd: sql<string>`(${occupiedEnd})::text`,
      eventName: eventRequests.eventName,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
      requestedById: venueRequests.requestedById,
      heldById: venueHolds.heldById,
      bookingStatus: venueRequests.status,
      holdStatus: venueHolds.status,
    })
    .from(venueOccupancy)
    .innerJoin(eventRequests, eq(eventRequests.id, venueOccupancy.eventId))
    .leftJoin(venueRequests, eq(venueRequests.id, venueOccupancy.venueRequestId))
    .leftJoin(venueHolds, eq(venueHolds.id, venueOccupancy.venueHoldId))
    .where(
      and(
        eq(venueOccupancy.venueId, block.venueId),
        eq(venueOccupancy.active, false),
        isNull(venueOccupancy.venueUnavailabilityId),
        sql`tsrange(${occupiedStart}, ${occupiedEnd}, '[)') <@ tsrange(${block.startsAt}::timestamp, ${block.endsAt}::timestamp, '[)')`
      )
    );
}

export type RestorableCommitment = Awaited<ReturnType<typeof loadRestorableCommitments>>[number];

/**
 * Restore each suspended row whose source is still live, and delete the rest. A booking counts
 * as live when approved, a hold when held. The app writers already delete replaced rows, so a
 * dead source here is defensive. Never touches block rows. Returns the rows it re-activated.
 * The caller deletes the block's own row before this runs.
 */
export async function restoreBlockCommitments(
  tx: VenueTx,
  rows: readonly RestorableCommitment[]
): Promise<RestorableCommitment[]> {
  const restored: RestorableCommitment[] = [];
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
  return restored;
}
