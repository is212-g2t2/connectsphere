import { sql } from "drizzle-orm";

import type { db as Db } from "#/db";

type Database = typeof Db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-109: the one per-venue serialisation point. Every venue writer takes this advisory lock
 * before any row lock or DML on `venue_holds`/`venue_requests` for that venue, so concurrent
 * writers queue in one order and cannot deadlock on each other's row locks (40P01). The lock is
 * transaction-scoped (`xact`), released when the surrounding transaction commits or rolls back.
 */
export async function lockVenue(tx: Transaction, venueId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${venueId})`);
}
