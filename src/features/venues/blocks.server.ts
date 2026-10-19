import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueUnavailability, venues } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { revertConfirmedEvents } from "#/features/events/revert.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
import {
  isDeadlock,
  loadBlockCommitments,
  loadRestorableCommitments,
  occupyVenue,
  restoreBlockCommitments,
  suspendBlockCommitments,
  vacateVenue,
} from "#/features/venue-requests/occupancy.server";
import type { BlockCommitment } from "#/features/venue-requests/occupancy.server";
import { keyShareEvent, lockVenue } from "#/features/venue-requests/venue-lock.server";
import type { LockedEvent, VenueTx } from "#/features/venue-requests/venue-lock.server";
import { venueBlockConflictMessage } from "#/features/venue-requests/schema";
import { venueLocalTimestamp } from "#/features/venues/availability";
import {
  VENUE_BLOCK_ALREADY_LIFTED_MESSAGE,
  VENUE_BLOCK_LIFT_OVERLAP_MESSAGE,
  VENUE_BLOCK_PAST_START_MESSAGE,
  VENUE_BLOCK_RETRY_MESSAGE,
  parseVenueBlockId,
  parseVenueBlockInput,
} from "#/features/venues/schema";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only. `server-fns.ts` imports it dynamically inside `.handler()`.
 * Record and lift venue blocks with the occupancy ledger (ADR-7). The handlers lock the venue,
 * call a core (`recordBlockRows`, `liftBlockRows`), and raise the notices. The seed calls the
 * cores and `occupyBlock` without notices.
 */

type Database = typeof Db;

/** A stored `venue_unavailability` row. */
type VenueBlockRow = typeof venueUnavailability.$inferSelect;

const log = logger.getChild("venue-blocks");

/**
 * Refuse a block that starts on a day before today. A block can start earlier today. The venues
 * are in Singapore, so read today from the venue wall clock (`venueLocalTimestamp`).
 */
export function assertBlockStartNotPast(date: string, now: Date): void {
  if (date < venueLocalTimestamp(now).slice(0, 10)) {
    throw new Error(VENUE_BLOCK_PAST_START_MESSAGE);
  }
}

/**
 * Key-share each event of the rows once, in ascending id order. Record and lift take the venue
 * lock first and then these event locks (ADR-7). Return the rows with the event status, name and
 * assigned Coordinator read under the event lock. A cancellation or a reassignment that committed
 * before the lock then counts in the notices.
 *
 * The requester and the hold owner need no refresh: only the booking and hold writers set them,
 * under the venue lock. An account deletion can still clear them.
 */
async function keyShareEvents(
  tx: VenueTx,
  rows: readonly BlockCommitment[]
): Promise<BlockCommitment[]> {
  const eventIds = [...new Set(rows.map(row => row.eventId))].toSorted((a, b) => a - b);
  const events = new Map<number, LockedEvent>();
  for (const eventId of eventIds) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- key-share in ascending id order
    const event = await keyShareEvent(tx, eventId);
    if (event) events.set(event.id, event);
  }
  return rows.map(row => {
    const event = events.get(row.eventId);
    if (!event) return row;
    return {
      ...row,
      eventStatus: event.status,
      eventName: event.eventName,
      assignedCoordinatorId: event.assignedCoordinatorId,
    };
  });
}

/**
 * Map a deadlock (40P01) to the retry refusal. Record and lift take the venue lock and then
 * key-share events. The seed takes its event rows and then a venue lock, so Postgres can abort
 * one of two concurrent writers.
 */
function rethrowBlockDeadlock(error: unknown): never {
  if (isDeadlock(error)) {
    log.warn("Refused a venue block write that deadlocked", { sqlstate: "40P01" });
    throw new ConflictError(VENUE_BLOCK_RETRY_MESSAGE);
  }
  throw error;
}

/**
 * Raise one `venue_block_changed` notice for each event and recipient. The recipient is the
 * event's assigned Coordinator, else the booking's requester, else the hold's owner. Log a
 * warning and skip a row that has none of them. A cancelled event gets no notice, though the
 * block still suspends or restores its booking or hold (PTR-54 keeps them).
 *
 * PTR-137: a record says when it took the event back to planning; a lift says when the restored
 * event still waits in planning. `planning` holds the ids of those events.
 */
async function notifyBlockChange(
  tx: VenueTx,
  rows: readonly BlockCommitment[],
  change: {
    action: "blocked" | "lifted";
    venueName: string;
    block: VenueBlockRow;
    planning: ReadonlySet<number>;
  }
): Promise<void> {
  const notices = new Map<string, NewNotification>();
  for (const row of rows) {
    if (row.eventStatus === "cancelled") continue;
    const recipientId = row.assignedCoordinatorId ?? row.requestedById ?? row.heldById;
    if (recipientId === null) {
      log.warn("No Coordinator to notify of the venue block", { eventId: row.eventId });
      continue;
    }
    notices.set(`${row.eventId}:${recipientId}`, {
      recipientId,
      eventRequestId: row.eventId,
      kind: "venue_block_changed",
      payload: {
        action: change.action,
        eventName: row.eventName,
        venueName: change.venueName,
        startsAt: change.block.startsAt,
        endsAt: change.block.endsAt,
        reason: change.block.reason,
        ...planningFlag(change.action, change.planning.has(row.eventId)),
      },
    });
  }
  await raiseNotifications(tx, [...notices.values()]);
}

/** The planning flag for one notice: the record that reverted the event, or the lift that restored it. */
function planningFlag(action: "blocked" | "lifted", isPlanning: boolean) {
  if (!isPlanning) return {};
  return action === "blocked" ? { revertedToPlanning: true } : { restoredToPlanning: true };
}

/** Return the ids among `eventIds` whose event is in planning. Read them after the lift restores the rows. */
async function eventsInPlanning(
  tx: Pick<Database, "select">,
  eventIds: readonly number[]
): Promise<Set<number>> {
  if (eventIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: eventRequests.id })
    .from(eventRequests)
    .where(and(inArray(eventRequests.id, [...eventIds]), eq(eventRequests.status, "planning")));
  return new Set(rows.map(row => row.id));
}

/**
 * Write the ledger rows of a block row: read the active commitments that the block covers,
 * key-share their events, suspend the commitments, then write the block's own ledger row. The
 * caller holds the venue lock. Return the covered commitments, with the event status read under
 * the event lock.
 */
export async function occupyBlock(
  tx: VenueTx,
  block: { id: number; venueId: number; startsAt: string; endsAt: string | null }
): Promise<BlockCommitment[]> {
  const extent = { venueId: block.venueId, startsAt: block.startsAt, endsAt: block.endsAt };
  const covered = await keyShareEvents(tx, await loadBlockCommitments(tx, extent));
  await suspendBlockCommitments(tx, extent, covered);
  await occupyVenue(tx, {
    ...extent,
    eventId: null,
    venueUnavailabilityId: block.id,
    setupMinutes: 0,
    turnaroundMinutes: 0,
  });
  return covered;
}

/**
 * Record a block at a venue. The caller holds the venue lock (`lockVenue`). Refuse a live block
 * that overlaps the period. Write the block row, then its ledger rows (`occupyBlock`). Raise no
 * notices. Return the block row and the commitments that it covers.
 *
 * Stamps use the database `YYYY-MM-DD HH:MM:SS` format. A null end stays until lifted.
 */
export async function recordBlockRows(
  tx: VenueTx,
  venue: { id: number; name: string },
  period: { startsAt: string; endsAt: string | null; reason: string },
  actorId: string
): Promise<{ block: VenueBlockRow; covered: BlockCommitment[] }> {
  const { startsAt, endsAt, reason } = period;
  const clashes = await tx
    .select({ startsAt: venueUnavailability.startsAt, endsAt: venueUnavailability.endsAt })
    .from(venueUnavailability)
    .where(
      and(
        eq(venueUnavailability.venueId, venue.id),
        isNull(venueUnavailability.liftedAt),
        sql`tsrange(${venueUnavailability.startsAt}, ${venueUnavailability.endsAt}, '[)') && tsrange(${startsAt}::timestamp, ${endsAt}::timestamp, '[)')`
      )
    )
    .orderBy(asc(venueUnavailability.startsAt))
    .limit(1);
  const clash = clashes.at(0);
  if (clash) {
    throw new ConflictError(venueBlockConflictMessage({ venueName: venue.name, ...clash }));
  }

  const [block] = await tx
    .insert(venueUnavailability)
    .values({ venueId: venue.id, startsAt, endsAt, reason, createdById: actorId })
    .returning()
    .catch((error: unknown) => {
      // The overlap probe above refuses a live duplicate. Only a writer outside the venue lock
      // reaches the unique index.
      if (isConstraintViolation(error, "venue_unavailability_period_idx")) {
        log.warn("Refused a venue block on a duplicate period", {
          constraint: "venue_unavailability_period_idx",
          venueId: venue.id,
        });
        throw new ConflictError(
          venueBlockConflictMessage({ venueName: venue.name, startsAt, endsAt })
        );
      }
      throw error;
    });
  return { block, covered: await occupyBlock(tx, block) };
}

/**
 * Lift a block. The caller holds the venue lock and read the block row `FOR UPDATE`. Refuse a
 * block that is already lifted. Key-share the suspended events, delete the block's ledger row,
 * restore the suspended commitments that are still live, and stamp the lift. Raise no notices.
 * Return the lifted row and the restored commitments.
 *
 * A new active row inside the block refuses the lift, and the transaction rolls back.
 */
export async function liftBlockRows(
  tx: VenueTx,
  block: VenueBlockRow,
  actorId: string
): Promise<{ block: VenueBlockRow; restored: BlockCommitment[] }> {
  if (block.liftedAt !== null) throw new ConflictError(VENUE_BLOCK_ALREADY_LIFTED_MESSAGE);

  const restorable = await keyShareEvents(tx, await loadRestorableCommitments(tx, block));
  await vacateVenue(tx, { venueUnavailabilityId: block.id });
  const restored = await restoreBlockCommitments(tx, restorable).catch((error: unknown) => {
    if (isConstraintViolation(error, "venue_occupancy_no_overlap")) {
      log.warn("Refused a venue block lift that a new row overlaps", { blockId: block.id });
      throw new ConflictError(VENUE_BLOCK_LIFT_OVERLAP_MESSAGE);
    }
    throw error;
  });

  const [lifted] = await tx
    .update(venueUnavailability)
    .set({ liftedAt: new Date(), liftedById: actorId })
    .where(eq(venueUnavailability.id, block.id))
    .returning();
  return { block: lifted, restored };
}

/**
 * Record a venue block for Venue Staff. Refuse a start day before today. Lock the venue, record
 * the block (`recordBlockRows`), then notify each covered event once for each recipient. A
 * deadlock gets the retry refusal (`rethrowBlockDeadlock`).
 */
export async function handleRecordVenueBlock(
  data: unknown,
  actor: SessionUser,
  database: Database,
  now = new Date()
) {
  const input = parseVenueBlockInput(data);
  assertBlockStartNotPast(input.date, now);
  const startsAt = `${input.date} ${input.startTime}:00`;
  const endsAt =
    input.endDate !== undefined && input.endTime !== undefined
      ? `${input.endDate} ${input.endTime}:00`
      : null;

  return database
    .transaction(async tx => {
      const venueRows = await tx
        .select({ id: venues.id, name: venues.name })
        .from(venues)
        .where(eq(venues.id, input.venueId))
        .limit(1);
      const venue = venueRows.at(0);
      if (!venue) throw new NotFoundError("Not Found");
      await lockVenue(tx, venue.id);

      const { block, covered } = await recordBlockRows(
        tx,
        venue,
        { startsAt, endsAt, reason: input.reason },
        actor.id
      );
      // PTR-137 AC2: after the ledger writes, revert each event whose booking the block covers.
      const reverted = await revertConfirmedEvents(tx, [
        ...new Set(covered.flatMap(row => (row.venueRequestId !== null ? [row.eventId] : []))),
      ]);
      await notifyBlockChange(tx, covered, {
        action: "blocked",
        venueName: venue.name,
        block,
        planning: reverted,
      });
      return block;
    })
    .catch(rethrowBlockDeadlock);
}

/**
 * Lift a venue block for Venue Staff. Lock the venue, re-read the block, lift it
 * (`liftBlockRows`), then notify each restored event once for each recipient. A deadlock gets the
 * retry refusal (`rethrowBlockDeadlock`).
 */
export async function handleLiftVenueBlock(data: unknown, actor: SessionUser, database: Database) {
  const { id } = parseVenueBlockId(data);

  return database
    .transaction(async tx => {
      const preview = await tx
        .select({ venueId: venueUnavailability.venueId })
        .from(venueUnavailability)
        .where(eq(venueUnavailability.id, id))
        .limit(1);
      const previewRow = preview.at(0);
      if (!previewRow) throw new NotFoundError("Not Found");
      await lockVenue(tx, previewRow.venueId);

      const rows = await tx
        .select({ block: venueUnavailability, venueName: venues.name })
        .from(venueUnavailability)
        .innerJoin(venues, eq(venues.id, venueUnavailability.venueId))
        .where(eq(venueUnavailability.id, id))
        .limit(1)
        .for("update", { of: venueUnavailability });
      const row = rows.at(0);
      if (!row) throw new NotFoundError("Not Found");

      const { block, restored } = await liftBlockRows(tx, row.block, actor.id);
      await notifyBlockChange(tx, restored, {
        action: "lifted",
        venueName: row.venueName,
        block,
        planning: await eventsInPlanning(tx, [
          ...new Set(restored.map(commitment => commitment.eventId)),
        ]),
      });
      return block;
    })
    .catch(rethrowBlockDeadlock);
}
