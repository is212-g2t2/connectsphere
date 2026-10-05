import { eq, sql } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, venueHolds, venueRequests } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";

type Database = typeof Db;
/** The transaction handle every venue writer receives from `database.transaction`. */
export type VenueTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-109: the one per-venue serialisation point. Every occupancy writer (hold creation,
 * release and conversion, booking approval, release and amendment) takes this advisory lock
 * before any row lock or DML on `venue_holds`/`venue_requests` for that venue, so concurrent
 * writers queue in one order and cannot deadlock on each other's row locks (40P01). The lock
 * is transaction-scoped (`xact`), released when the surrounding transaction commits or rolls
 * back. Row-lock-only writers (withdraw, reject) do not take it: they hold nothing.
 */
export async function lockVenue(tx: VenueTx, venueId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${venueId})`);
}

/**
 * The preview read every venue writer starts with: learn which venue's lock to take, then
 * take it. A missing row is Not Found before any lock, matching the handlers' old order.
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

/**
 * Key-share a venue request's event before any venue row lock. A decision notification inserted
 * later in the transaction takes this lock through its FK. Taking it while holding the request row
 * deadlocks against confirmation, which locks the event first and then the event's venue requests.
 */
export async function keyShareEventForRequest(tx: VenueTx, requestId: string) {
  const rows = await tx
    .select({ eventId: venueRequests.eventId })
    .from(venueRequests)
    .where(eq(venueRequests.id, requestId))
    .limit(1);
  const preview = rows.at(0);
  if (!preview) return null; // The row lock that follows reports Not Found.
  const eventRows = await tx
    .select({ id: eventRequests.id, status: eventRequests.status })
    .from(eventRequests)
    .where(eq(eventRequests.id, preview.eventId))
    .for("key share");
  return eventRows.at(0) ?? null;
}

/**
 * Lockless preview for writers that lock more than one venue (amendment): learn the current
 * venue without taking its lock, so the caller takes the sorted pair as its only lock order.
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
 * The row re-read under the lock must still belong to the locked venue; a venue change between
 * the preview and the row lock means the wrong serialisation order was taken.
 */
export function assertSameVenue(lockedVenueId: number, rowVenueId: number): void {
  if (rowVenueId !== lockedVenueId) {
    throw new ConflictError("The venue changed while this request was being processed. Try again.");
  }
}
