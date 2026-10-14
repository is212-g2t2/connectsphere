import { eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueHolds, venueRequests } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { EventRequestStatus } from "#/features/event-requests/schema";

type Database = typeof Db;
/** The transaction handle every venue writer receives from `database.transaction`. */
export type VenueTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-109: Serialize all occupancy writes for one venue with this advisory lock.
 * Hold creation, release, conversion, booking approval, release, and amendment take it before
 * locking rows or changing `venue_holds`, `venue_requests` or `venue_occupancy` (ADR-7). Their
 * pre-checks read the ledger under it, so they see every committed row. The venue save takes it
 * too, and relies on it alone to serialize the buffer columns. This gives writers one lock order
 * and prevents deadlocks (40P01). The `xact` lock ends when its transaction commits or rolls back.
 * Request creation takes it after the event lock, so its same-event overlap check (PTR-138 AC4)
 * sees every committed request. Withdraw and reject only lock rows because they do not hold venue
 * time.
 */
export async function lockVenue(tx: VenueTx, venueId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${venueId})`);
}

/**
 * Read which venue to lock before taking the venue lock. Return Not Found for a missing row before
 * taking any lock, as the handlers did before.
 */
async function previewVenueId(
  tx: VenueTx,
  table: typeof venueRequests | typeof venueHolds,
  id: string
): Promise<number> {
  const rows = await tx
    .select({ venueId: table.venueId })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  const preview = rows.at(0);
  if (!preview) throw new NotFoundError("Not Found");
  await lockVenue(tx, preview.venueId);
  return preview.venueId;
}

/** Preview, then lock, for a `venue_requests` writer. Returns the locked venue id. */
export async function lockVenueForRequest(tx: VenueTx, requestId: string): Promise<number> {
  return previewVenueId(tx, venueRequests, requestId);
}

/** The event row a venue writer locks, as its gates read it. */
type LockedEvent = { id: number; status: EventRequestStatus };

/**
 * Key-share the event before any venue lock. Return `{ id, status }` as read under that lock, or
 * `null` when the event is missing. Cancellation holds the event `FOR UPDATE` (PTR-54), so this
 * lock waits for it and then reads the new status. A later cancellation waits for this transaction.
 */
export async function keyShareEvent(tx: VenueTx, eventId: number): Promise<LockedEvent | null> {
  const rows = await tx
    .select({ id: eventRequests.id, status: eventRequests.status })
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId))
    .for("key share");
  return rows.at(0) ?? null;
}

/**
 * Call `keyShareEvent` for a writer that starts from a venue request or hold. Return `null` when
 * that row is missing. A notification or request insert takes this event lock through its foreign
 * key. Do not take it while holding the request row; confirmation locks the event before requests,
 * which would cause a deadlock.
 */
async function keyShareEventOf(
  tx: VenueTx,
  table: typeof venueRequests | typeof venueHolds,
  id: string
): Promise<LockedEvent | null> {
  const rows = await tx
    .select({ eventId: table.eventId })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  const preview = rows.at(0);
  if (!preview) return null; // The row lock that follows reports Not Found.
  return keyShareEvent(tx, preview.eventId);
}

/** Key-share a venue request's event before any venue row lock. */
export async function keyShareEventForRequest(
  tx: VenueTx,
  requestId: string
): Promise<LockedEvent | null> {
  return keyShareEventOf(tx, venueRequests, requestId);
}

/** Key-share a hold's event before any venue row lock. */
export async function keyShareEventForHold(
  tx: VenueTx,
  holdId: string
): Promise<LockedEvent | null> {
  return keyShareEventOf(tx, venueHolds, holdId);
}

/**
 * Read the current venue without locking it. Writers that change two venues use this preview, then
 * lock both venues in sorted order.
 */
export async function previewVenueForRequest(tx: VenueTx, requestId: string): Promise<number> {
  const rows = await tx
    .select({ venueId: venueRequests.venueId })
    .from(venueRequests)
    .where(eq(venueRequests.id, requestId))
    .limit(1);
  const preview = rows.at(0);
  if (!preview) throw new NotFoundError("Not Found");
  return preview.venueId;
}

/** Preview, then lock, for a `venue_holds` writer. Returns the locked venue id. */
export async function lockVenueForHold(tx: VenueTx, holdId: string): Promise<number> {
  return previewVenueId(tx, venueHolds, holdId);
}

/**
 * Check that the row still belongs to the locked venue. If it changed after preview, the caller
 * took locks in the wrong order.
 */
export function assertSameVenue(lockedVenueId: number, rowVenueId: number): void {
  if (rowVenueId !== lockedVenueId) {
    throw new ConflictError("The venue changed while this request was being processed. Try again.");
  }
}
