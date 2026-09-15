import { and, asc, count, desc, eq, getTableColumns, isNull, ne } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, user as users } from "#/db/schema";
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

/** Who a request can be traced to: the Coordinator handling it, or the Organiser who raised it. */
export interface Contact {
  name: string;
  email: string;
}

/** A request with its Coordinator resolved, for the organiser's list and detail (PTR-15 AC3). */
export type EventRequestWithCoordinator = EventRequest & { coordinator: Contact | null };

/** A submitted request nobody is handling yet, with its Organiser, for the unassigned list (AC5). */
export type EventRequestWithOrganiser = EventRequest & { organiser: Contact };

/**
 * The selection every read of a request goes through: the row plus the assigned Coordinator's
 * name and email, via a left join. Drizzle folds a nested selection whose columns are all null —
 * the unassigned case — into `coordinator: null`, which is the contract the pages render against.
 */
const withCoordinator = {
  ...getTableColumns(eventRequests),
  coordinator: { name: users.name, email: users.email },
};

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

    // PTR-15 criterion 1: the Coordinator is chosen in the same transaction that submits, so a
    // submitted row never exists without one while one could be had. `null` when the system has
    // no Coordinator at all (criterion 5); the row then waits in the unassigned list.
    const coordinator = await pickLeastLoadedCoordinator(tx);
    const now = new Date();

    const [submitted] = await tx
      .update(eventRequests)
      .set({
        status: "submitted",
        submittedAt: now,
        assignedCoordinatorId: coordinator?.id ?? null,
        assignedAt: coordinator === null ? null : now,
      })
      .where(ownDraft(id, user.id))
      .returning();

    return submitted;
  });
}

/**
 * The assignment rule (PTR-15 criterion 1): the Event Coordinator currently handling the fewest
 * submitted requests, ties broken by the earliest account so the rule is deterministic and
 * testable. Each submission re-reads the load at the moment it runs. Two submissions that overlap
 * can read the same counts and land on the same Coordinator — the `for update` lock in the
 * submit transaction covers the draft row, not this read — which criterion 1 permits; serialising
 * the pick is a trade against contention to weigh if burst fairness ever matters.
 *
 * Every non-draft request counts as load for now. When PTR-21's terminal statuses (completed,
 * cancelled, rejected) exist, they are the ones to exclude here.
 *
 * Exported for the integration test; its one application caller is `handleSubmitEventRequest`.
 */
export async function pickLeastLoadedCoordinator(
  database: Pick<Database, "select">
): Promise<{ id: string } | null> {
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .leftJoin(
      eventRequests,
      and(eq(eventRequests.assignedCoordinatorId, users.id), ne(eventRequests.status, "draft"))
    )
    .where(eq(users.role, "event_coordinator"))
    .groupBy(users.id, users.createdAt)
    .orderBy(asc(count(eventRequests.id)), asc(users.createdAt), asc(users.id))
    .limit(1);

  return rows.at(0) ?? null;
}

/**
 * PTR-14 criterion 1: the organiser's own requests, drafts included. Most recently changed
 * first, then newest id, so two rows saved in the same instant still list in a stable order.
 */
export async function handleListEventRequests(
  organiser: SessionUser,
  database: Database
): Promise<EventRequestWithCoordinator[]> {
  return database
    .select(withCoordinator)
    .from(eventRequests)
    .leftJoin(users, eq(users.id, eventRequests.assignedCoordinatorId))
    .where(eq(eventRequests.organiserId, organiser.id))
    .orderBy(desc(eventRequests.updatedAt), desc(eventRequests.id));
}

/**
 * PTR-14 criterion 4: one request, as recorded. Scoped to the organiser so a row that belongs
 * to someone else reads as absent — the route answers both with the same not-found view, which
 * is what keeps another organiser's ids from being probed.
 */
export async function handleGetEventRequest(
  data: unknown,
  organiser: SessionUser,
  database: Database
): Promise<EventRequestWithCoordinator | null> {
  const { id } = parseEventRequestId(data);
  const rows = await database
    .select(withCoordinator)
    .from(eventRequests)
    .leftJoin(users, eq(users.id, eventRequests.assignedCoordinatorId))
    .where(ownRequest(id, organiser.id));
  return rows.at(0) ?? null;
}

/**
 * PTR-15 criterion 5: every submitted request with nobody handling it, oldest wait first, with
 * the Organiser who raised it. Read by any Event Coordinator; picking one up is PTR-16.
 */
export async function handleListUnassignedEventRequests(
  database: Database
): Promise<EventRequestWithOrganiser[]> {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: users.name, email: users.email },
    })
    .from(eventRequests)
    .innerJoin(users, eq(users.id, eventRequests.organiserId))
    .where(and(ne(eventRequests.status, "draft"), isNull(eventRequests.assignedCoordinatorId)))
    .orderBy(asc(eventRequests.submittedAt), asc(eventRequests.id));
}
