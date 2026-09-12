import { and, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";
import { AuthorizationError, requirePermission } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseDraftInput } from "#/features/event-requests/schema";

/**
 * Server-only on purpose, and named for it. `#/db/schema` is a value import here: the table
 * builders run at module scope, so a bundler cannot treat the module as side-effect free and
 * drops nothing — importing this from anywhere the browser can reach would ship the whole
 * database schema, Better Auth tables included. `server-fns.ts` reaches it through a dynamic
 * `import()` inside `.handler()`, which is the seam that keeps it off the client.
 */

type Database = typeof Db;
export type EventRequest = typeof eventRequests.$inferSelect;

/**
 * Full-replace (PUT-style), not merge: an update writes every field from `data`, defaulting
 * anything absent to blank/null exactly as a create would. The form always resends the complete
 * draft, so this matches actual usage; a partial payload against an existing `id` blanks the
 * fields it omits rather than leaving them untouched.
 */
export async function handleSaveEventRequestDraft(
  data: unknown,
  user: SessionUser | null,
  database: Database
): Promise<EventRequest> {
  const currentUser = requirePermission(user, { event_request: ["create"] });
  const { id, ...values } = parseDraftInput(data);

  const fields = { ...values, expectedAttendance: values.expectedAttendance ?? null };

  if (id === undefined) {
    const [created] = await database
      .insert(eventRequests)
      .values({ organiserId: currentUser.id, status: "draft", ...fields })
      .returning();

    return created;
  }

  // Scoped to the organiser's own drafts, so an id belonging to someone else updates nothing.
  // Refusing rather than falling back to an insert is what stops one save from silently
  // becoming two drafts.
  const updated = await database
    .update(eventRequests)
    .set(fields)
    .where(
      and(
        eq(eventRequests.id, id),
        eq(eventRequests.organiserId, currentUser.id),
        eq(eventRequests.status, "draft")
      )
    )
    .returning();

  if (updated.length === 0) {
    throw new AuthorizationError("Forbidden", 403);
  }

  return updated[0];
}
