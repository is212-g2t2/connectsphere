import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { user } from "#/db/schema";

/**
 * Keep this module server-only. Its value import of `#/db/schema` builds tables at module scope,
 * so the bundler keeps the full module. Every caller is a `.server.ts` module, so no
 * client-reachable import reaches it.
 *
 * PTR-144: a submission and a change or cancellation request on an unassigned event notify every
 * Event Coordinator Lead, on an unassigned event. PTR-148: so does a safety revert that returns
 * the event to planning. The fan-out reads the accounts here, so the rule has one home.
 */
type Database = typeof Db;
/**
 * The transaction handle. Typing the parameter with it stops a caller from passing `db`: the
 * `for share` lock below only holds the accounts for the caller's own transaction.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function listLeadIds(database: Pick<Transaction, "select">): Promise<string[]> {
  const rows = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "event_coordinator_lead"))
    // Hold the referenced accounts while the caller writes their notifications, as the
    // coordination readers do: a deletion racing the insert must not surface as an FK violation.
    .for("share");

  return rows.map(row => row.id);
}
