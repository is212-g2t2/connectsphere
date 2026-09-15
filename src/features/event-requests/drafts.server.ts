import { and, desc, eq } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  ALREADY_SUBMITTED_MESSAGE,
  SUBMITTED_EDIT_REFUSAL,
  missingFieldsMessage,
  missingRequiredFields,
  parseDraftInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";

/**
 * Server-only on purpose, and named for it. `#/db/schema` is a value import here: the table
 * builders run at module scope, so a bundler cannot treat the module as side-effect free and
 * drops nothing — importing this from anywhere the browser can reach would ship the whole
 * database schema, Better Auth tables included. `server-fns.ts` reaches it through a dynamic
 * `import()` inside `.handler()`, which is the seam that keeps it off the client.
 *
 * The middleware pipeline has already verified the session and `event_request:create` before
 * this runs; `user` here is the verified organiser.
 */

type Database = typeof Db;
export type EventRequest = typeof eventRequests.$inferSelect;

function ownRequest(id: number, organiserId: string) {
  return and(eq(eventRequests.id, id), eq(eventRequests.organiserId, organiserId));
}

// The status clause is what keeps a submitted request from being written again, whichever path
// is asking.
function ownDraft(id: number, organiserId: string) {
  return and(
    eq(eventRequests.id, id),
    eq(eventRequests.organiserId, organiserId),
    eq(eventRequests.status, "draft")
  );
}

/**
 * Full-replace (PUT-style), not merge: an update writes every field from `data`, defaulting
 * anything absent to blank/null exactly as a create would. The form always resends the complete
 * draft, so this matches actual usage; a partial payload against an existing `id` blanks the
 * fields it omits rather than leaving them untouched.
 */
export async function handleSaveEventRequestDraft(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest> {
  const { id, ...values } = parseDraftInput(data);

  // The registration transform has already dropped the terms when registration is off; `?? null`
  // is what writes that drop, and what keeps a half-written draft's absent terms null.
  const fields = {
    ...values,
    expectedAttendance: values.expectedAttendance ?? null,
    registrationCapacity: values.registrationCapacity ?? null,
    registrationOpensAt: values.registrationOpensAt ?? null,
    registrationClosesAt: values.registrationClosesAt ?? null,
  };

  if (id === undefined) {
    const [created] = await database
      .insert(eventRequests)
      .values({ organiserId: user.id, status: "draft", ...fields })
      .returning();

    return created;
  }

  // Scoped to the organiser's own drafts, so an id belonging to someone else updates nothing.
  // Refusing rather than falling back to an insert is what stops one save from silently
  // becoming two drafts.
  const updated = await database
    .update(eventRequests)
    .set(fields)
    .where(ownDraft(id, user.id))
    .returning();

  if (updated.length === 0) {
    // The row may be the organiser's but no longer a draft. Refusing it as "Forbidden" would
    // blame the role for a request that was submitted in this or another sitting, so the
    // submitted case answers with the direction PTR-13 criterion 3 asks for instead.
    const ownRow = await database
      .select({ id: eventRequests.id })
      .from(eventRequests)
      .where(ownRequest(id, user.id));

    if (ownRow.length > 0) {
      throw new ConflictError(SUBMITTED_EDIT_REFUSAL);
    }

    throw new AuthorizationError("Forbidden");
  }

  return updated[0];
}

/**
 * PTR-13: submits the organiser's own draft, refusing it while a mandatory field is missing
 * (criterion 1) and recording the time it was submitted (criterion 2).
 *
 * The stored row is the source of truth rather than whatever the page last held, so a submission
 * cannot carry values that were never saved. PTR-11's registration terms are not re-checked
 * here: a stored draft cannot have them missing or half-set — the save path requires all three
 * together and the database CHECKs refuse the row — so their absence is never reachable.
 */
export async function handleSubmitEventRequest(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest> {
  const { id } = parseEventRequestId(data);

  // One transaction, with the row locked while it is read: a save in another tab must not blank
  // a mandatory field between the completeness check and the update below. Only the update needs
  // the lock — the save path's own predicate already refuses a submitted row, and it will block
  // here until this transaction commits if it arrives mid-flight.
  return database.transaction(async tx => {
    const ownRows = await tx
      .select()
      .from(eventRequests)
      .where(ownRequest(id, user.id))
      .for("update");

    const draft = ownRows.at(0);
    if (draft === undefined) {
      throw new AuthorizationError("Forbidden");
    }
    if (draft.status !== "draft") {
      throw new ConflictError(ALREADY_SUBMITTED_MESSAGE);
    }

    const missing = missingRequiredFields(draft);
    if (missing.length > 0) {
      throw new Error(missingFieldsMessage(missing));
    }

    const [submitted] = await tx
      .update(eventRequests)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(ownDraft(id, user.id))
      .returning();

    return submitted;
  });
}

/**
 * PTR-14 criterion 1: the organiser's own requests, drafts included. Most recently changed
 * first, then newest id, so two rows saved in the same instant still list in a stable order.
 */
export async function handleListEventRequests(
  user: SessionUser,
  database: Database
): Promise<EventRequest[]> {
  return database
    .select()
    .from(eventRequests)
    .where(eq(eventRequests.organiserId, user.id))
    .orderBy(desc(eventRequests.updatedAt), desc(eventRequests.id));
}

/**
 * PTR-14 criterion 4: one request, as recorded. Scoped to the organiser so a row that belongs
 * to someone else reads as absent — the route answers both with the same not-found view, which
 * is what keeps another organiser's ids from being probed.
 */
export async function handleGetEventRequest(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest | null> {
  const { id } = parseEventRequestId(data);
  const rows = await database.select().from(eventRequests).where(ownRequest(id, user.id));
  return rows.at(0) ?? null;
}
