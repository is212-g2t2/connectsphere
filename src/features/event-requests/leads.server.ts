import { eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { user } from "#/db/schema";

/**
 * Keep this module server-only. Its value import of `#/db/schema` builds tables at module scope,
 * so the bundler keeps the full module. Every caller is a `.server.ts` module, so no
 * client-reachable import reaches it.
 *
 * PTR-144: a submission and a change or cancellation request on an unassigned event notify every
 * Event Coordinator Lead. The fan-out reads the accounts here, so the rule has one home.
 */
type Database = typeof Db;

export async function listLeadIds(database: Pick<Database, "select">): Promise<string[]> {
  const rows = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "event_coordinator_lead"))
    // Hold the referenced accounts while the caller writes their notifications, as the
    // coordination readers do: a deletion racing the insert must not surface as an FK violation.
    .for("share");

  return rows.map(row => row.id);
}
