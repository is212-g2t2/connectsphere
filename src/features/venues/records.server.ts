import { asc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { venues } from "#/db/schema";
import { AuthorizationError, requirePermission } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseVenueId, parseVenueInput } from "#/features/venues/schema";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach.
 * `server-fns.ts` reaches this through a dynamic `import()` inside `.handler()`.
 */

type Database = typeof Db;
export type Venue = typeof venues.$inferSelect;

export async function handleListVenues(
  user: SessionUser | null,
  database: Database
): Promise<Venue[]> {
  requirePermission(user, { venue: ["read"] });
  return database.select().from(venues).orderBy(asc(venues.name));
}

export async function handleGetVenue(
  data: unknown,
  user: SessionUser | null,
  database: Database
): Promise<Venue | null> {
  requirePermission(user, { venue: ["read"] });
  const { id } = parseVenueId(data);
  const rows = await database.select().from(venues).where(eq(venues.id, id));
  return rows.at(0) ?? null;
}

/**
 * Create when no `id` is supplied, otherwise a full replace of that row (PTR-26 criterion 1).
 * The permission is checked *before* the payload is parsed, so a Coordinator posting a
 * malformed record is told "Forbidden", not what was wrong with it (criterion 4).
 */
export async function handleSaveVenue(
  data: unknown,
  user: SessionUser | null,
  database: Database
): Promise<Venue> {
  const isUpdate =
    typeof data === "object" && data !== null && "id" in data && data.id !== undefined;
  requirePermission(user, { venue: [isUpdate ? "update" : "create"] });

  const { id, ...fields } = parseVenueInput(data);

  if (id === undefined) {
    const [created] = await database.insert(venues).values(fields).returning();
    return created;
  }

  const updated = await database.update(venues).set(fields).where(eq(venues.id, id)).returning();

  if (updated.length === 0) {
    // No such venue. A 404 would be the purist answer, but `AuthorizationError` is the one
    // status-carrying error the boundary already converts, and an id the caller never listed
    // is not theirs to edit.
    throw new AuthorizationError("Forbidden", 403);
  }

  return updated[0];
}
