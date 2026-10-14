import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { venueUnavailability, venues } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { raiseNotifications } from "#/features/notifications/raise.server";
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
import {
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  venueBlockConflictMessage,
} from "#/features/venue-requests/schema";
import { parseVenueBlockId, parseVenueBlockInput } from "#/features/venues/schema";
import { isConstraintViolation } from "#/lib/db-errors";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only. `server-fns.ts` imports it dynamically inside `.handler()`.
 * Record and lift venue blocks with the occupancy ledger (ADR-7 suspension).
 */

type Database = typeof Db;

const log = logger.getChild("venue-blocks");

/** One row that can yield a notice: an event plus its possible owners. */
type NoticeSource = Pick<
  BlockCommitment,
  "eventId" | "eventName" | "assignedCoordinatorId" | "requestedById" | "heldById"
>;

/** One `venue_block_changed` recipient: the event request, its name and coordinator. */
interface CollectedNotice {
  eventRequestId: number;
  eventName: string;
  recipientId: string;
}

/** Notice context shared by record and lift: venue, period, reason and action. */
interface NoticeContext {
  venueName: string;
  startsAt: string;
  endsAt: string | null;
  reason: string;
  action: "blocked" | "lifted";
}

/**
 * Pick the notice recipient: the assigned coordinator, else the request raiser, else the hold
 * owner. Returns null when no owner remains.
 */
function noticeRecipient(row: {
  assignedCoordinatorId: string | null;
  requestedById: string | null;
  heldById: string | null;
}): string | null {
  return row.assignedCoordinatorId ?? row.requestedById ?? row.heldById;
}

/** Collect one notice per (event, recipient). Warn and skip rows with no owner. */
function collectBlockNotices(rows: readonly NoticeSource[]): CollectedNotice[] {
  const seen = new Set<string>();
  const notices: CollectedNotice[] = [];
  for (const row of rows) {
    if (row.eventId === null) continue;
    const recipientId = noticeRecipient(row);
    if (!recipientId) {
      log.warn("No Coordinator to notify of the venue block", { eventId: row.eventId });
      continue;
    }
    const key = `${row.eventId}:${recipientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notices.push({ eventRequestId: row.eventId, eventName: row.eventName, recipientId });
  }
  return notices;
}

/** Raise one `venue_block_changed` row per collected notice. */
async function raiseBlockNotices(
  tx: Pick<Database, "insert">,
  notices: readonly CollectedNotice[],
  context: NoticeContext
): Promise<void> {
  await raiseNotifications(
    tx,
    notices.map(notice => ({
      recipientId: notice.recipientId,
      eventRequestId: notice.eventRequestId,
      kind: "venue_block_changed" as const,
      payload: {
        action: context.action,
        eventName: notice.eventName,
        venueName: context.venueName,
        startsAt: context.startsAt,
        endsAt: context.endsAt,
        reason: context.reason,
      },
    }))
  );
}

/**
 * Record a venue block. Reads the venue, locks it, refuses a live overlapping block, suspends
 * the covered commitments, writes the block row and its ledger row, then notifies each
 * affected event once per (event, recipient).
 */
export async function handleRecordVenueBlock(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseVenueBlockInput(data);
  const startsAt = `${input.date} ${input.startTime}:00`;
  const endsAt =
    input.endDate !== undefined && input.endTime !== undefined
      ? `${input.endDate} ${input.endTime}:00`
      : null;

  return database.transaction(async tx => {
    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.id, input.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");
    await lockVenue(tx, venue.id);

    const clashes = await tx
      .select({
        startsAt: venueUnavailability.startsAt,
        endsAt: venueUnavailability.endsAt,
      })
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
      throw new ConflictError(
        venueBlockConflictMessage({
          venueName: venue.name,
          startsAt: clash.startsAt,
          endsAt: clash.endsAt,
        })
      );
    }

    const block = { venueId: venue.id, startsAt, endsAt };
    const commitments = await loadBlockCommitments(tx, block);
    const eventIds = [
      ...new Set(commitments.map(row => row.eventId).filter((id): id is number => id !== null)),
    ].toSorted((left, right) => left - right);
    for (const eventId of eventIds) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- key-share in ascending id order
      await keyShareEvent(tx, eventId);
    }

    await suspendBlockCommitments(tx, block, commitments);
    const [recorded] = await tx
      .insert(venueUnavailability)
      .values({
        venueId: venue.id,
        startsAt,
        endsAt,
        reason: input.reason,
        createdById: actor.id,
      })
      .returning()
      .catch((error: unknown) => {
        if (isConstraintViolation(error, "venue_unavailability_period_idx")) {
          log.warn("Refused a venue block on a duplicate period", {
            constraint: "venue_unavailability_period_idx",
            venueId: venue.id,
          });
          throw new ConflictError(VENUE_OCCUPANCY_CONFLICT_MESSAGE);
        }
        throw error;
      });
    await occupyVenue(tx, {
      venueId: venue.id,
      eventId: null,
      venueUnavailabilityId: recorded.id,
      startsAt,
      endsAt,
      setupMinutes: 0,
      turnaroundMinutes: 0,
    });

    await raiseBlockNotices(tx, collectBlockNotices(commitments), {
      venueName: venue.name,
      startsAt,
      endsAt,
      reason: input.reason,
      action: "blocked",
    });

    return recorded;
  });
}

/**
 * Lift a venue block. Locks the venue, re-reads the block, drops its ledger row, restores the
 * suspended commitments that are still live, stamps the lift, then notifies each restored
 * event once per (event, recipient). A new overlap refuses the lift and rolls back.
 */
export async function handleLiftVenueBlock(data: unknown, actor: SessionUser, database: Database) {
  const { id } = parseVenueBlockId(data);

  return database.transaction(async tx => {
    const preview = await tx
      .select({ venueId: venueUnavailability.venueId })
      .from(venueUnavailability)
      .where(eq(venueUnavailability.id, id))
      .limit(1);
    const previewRow = preview.at(0);
    if (!previewRow) throw new NotFoundError("Not Found");
    await lockVenue(tx, previewRow.venueId);

    const rows = await tx
      .select()
      .from(venueUnavailability)
      .where(eq(venueUnavailability.id, id))
      .limit(1)
      .for("update");
    const block = rows.at(0);
    if (!block) throw new NotFoundError("Not Found");
    if (block.liftedAt !== null) {
      throw new ConflictError("This block has already been lifted.");
    }
    const venueRows = await tx
      .select({ name: venues.name })
      .from(venues)
      .where(eq(venues.id, block.venueId))
      .limit(1);
    const venue = venueRows.at(0);
    if (!venue) throw new NotFoundError("Not Found");

    const extent = { venueId: block.venueId, startsAt: block.startsAt, endsAt: block.endsAt };
    const restorable = await loadRestorableCommitments(tx, extent);
    const eventIds = [
      ...new Set(
        restorable.map(row => row.eventId).filter((value): value is number => value !== null)
      ),
    ].toSorted((left, right) => left - right);
    for (const eventId of eventIds) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- key-share in ascending id order
      await keyShareEvent(tx, eventId);
    }

    await vacateVenue(tx, { venueUnavailabilityId: block.id });
    let restored: typeof restorable;
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- restore runs once per lift
      restored = await restoreBlockCommitments(tx, restorable);
    } catch (error) {
      if (isConstraintViolation(error, "venue_occupancy_no_overlap") || isDeadlock(error)) {
        if (isDeadlock(error)) {
          log.warn("Refused an occupancy write that deadlocked", { sqlstate: "40P01" });
        }
        throw new ConflictError(
          "A new arrangement now overlaps this block, so it cannot be lifted."
        );
      }
      throw error;
    }

    const [lifted] = await tx
      .update(venueUnavailability)
      .set({ liftedAt: new Date(), liftedById: actor.id })
      .where(eq(venueUnavailability.id, block.id))
      .returning();

    await raiseBlockNotices(tx, collectBlockNotices(restored), {
      venueName: venue.name,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      reason: block.reason,
      action: "lifted",
    });

    return lifted;
  });
}
