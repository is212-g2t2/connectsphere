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

export const DUPLICATE_NAME_MESSAGE = "A venue with this name already exists";

/**
 * Postgres reports a unique violation as a driver error that Drizzle wraps; the constraint
 * name is on `cause`. Turned into the sentence the form is built to show, since a duplicate
 * name is the one conflict the UI can trigger by itself.
 */
function rethrowReadable(error: unknown): never {
  if (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "constraint" in error.cause &&
    error.cause.constraint === "venues_name_unique"
  ) {
    throw new Error(DUPLICATE_NAME_MESSAGE, { cause: error });
  }
  throw error;
}

/**
 * Create when no `id` is supplied, otherwise a full replace of that row (PTR-26 criterion 1).
 * The permission is checked before the payload is parsed here, which matters for direct
 * callers such as the integration tests. At the HTTP boundary the payload arrives already
 * validated — `.validator(parseVenueInput)` on `saveVenue` runs before the handler — so a
 * malformed record from any caller gets the first Zod message, not "Forbidden"; the real
 * 401/403 come from the `AuthorizationError` conversion in `server-fns.ts` (criterion 4).
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
    const [created] = await database
      .insert(venues)
      .values(fields)
      .returning()
      .catch(rethrowReadable);
    return created;
  }

  const updated = await database
    .update(venues)
    .set(fields)
    .where(eq(venues.id, id))
    .returning()
    .catch(rethrowReadable);

  if (updated.length === 0) {
    // No such venue. A 404 would be the purist answer, but `AuthorizationError` is the one
    // status-carrying error the boundary already converts, and an id the caller never listed
    // is not theirs to edit.
    throw new AuthorizationError("Forbidden", 403);
  }

  return updated[0];
}
