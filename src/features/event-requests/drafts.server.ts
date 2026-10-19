import { and, asc, desc, eq, getTableColumns, isNull, ne } from "drizzle-orm";

import type { db as Db } from "#/db";
import { clarificationRequests, eventRequests, user as users } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  cancellationRequestedSql,
  listEventCancellationRequests,
} from "#/features/event-requests/cancellation-requests.server";
import {
  changeRequestsWaitingSql,
  listEventChangeRequests,
} from "#/features/event-requests/change-requests.server";
import { listLeadIds } from "#/features/event-requests/leads.server";
import {
  ALREADY_SUBMITTED_MESSAGE,
  EVENT_REQUEST_DELETE_REFUSAL,
  EVENT_REQUEST_REUSE_REFUSAL,
  SUBMITTED_EDIT_REFUSAL,
  canReuseEventRequest,
  missingFieldsMessage,
  missingRequiredFields,
  parseDraftInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { eventTiming } from "#/features/events/access";
import { singaporeLocalEndHasPassed } from "#/features/events/completion";
import { raiseNotifications } from "#/features/notifications/raise.server";

/**
 * Keep this module server-only. Its value import of `#/db/schema` builds tables at module scope, so
 * the bundler keeps the full module. A client-reachable import would ship the database schema,
 * including Better Auth tables. `server-fns.ts` imports it dynamically inside `.handler()`.
 *
 * Middleware verifies the session and `event_request:create` before this runs. `user` is the verified organiser.
 */

type Database = typeof Db;
export type EventRequest = typeof eventRequests.$inferSelect;

/** The Coordinator handling the request or the Organiser who raised it. */
export interface Contact {
  name: string;
  email: string;
}

/** A request with its Coordinator for the Organiser's list (PTR-15 AC3). The detail view adds clarifications. */
export type EventRequestWithCoordinator = EventRequest & { coordinator: Contact | null };

/** A submitted request nobody is handling yet, with its Organiser, for the Lead's queue (PTR-144). */
export type EventRequestWithOrganiser = EventRequest & {
  organiser: Contact;
  /** PTR-144 AC2: the Organiser's change requests that still wait on the team. */
  changeRequestsWaiting: number;
  /** PTR-144 AC2: a live cancellation request waits on the team. */
  cancellationRequested: boolean;
};

/**
 * Select the request row and its assigned Coordinator's name and email with a left join.
 * Drizzle returns `coordinator: null` when the joined columns are all null. Pages use that shape
 * for unassigned requests.
 */
const withCoordinator = {
  ...getTableColumns(eventRequests),
  coordinator: { name: users.name, email: users.email },
};

function ownRequest(id: number, organiserId: string) {
  return and(eq(eventRequests.id, id), eq(eventRequests.organiserId, organiserId));
}

// The status clause prevents any path from writing a submitted request again.
function ownDraft(id: number, organiserId: string) {
  return and(
    eq(eventRequests.id, id),
    eq(eventRequests.organiserId, organiserId),
    eq(eventRequests.status, "draft")
  );
}

/**
 * A write may match no draft because the row belongs to another organiser or is no longer a draft.
 * Use a different message for each case. "Forbidden" would blame the user's role when the request
 * was submitted in another tab. Use the direction requested by the caller for submitted rows.
 */
async function ownRowExists(id: number, organiserId: string, database: Database): Promise<boolean> {
  const rows = await database
    .select({ id: eventRequests.id })
    .from(eventRequests)
    .where(ownRequest(id, organiserId));

  return rows.length > 0;
}

/**
 * Replace the full draft, like a PUT; do not merge. Write every field from `data`, with absent
 * values set to blank or `null`, as on create. The form sends the full draft. A partial payload
 * blanks omitted fields instead of leaving them unchanged.
 */
export async function handleSaveEventRequestDraft(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest> {
  const { id, ...values } = parseDraftInput(data);

  // The registration transform drops the terms when registration is off. `?? null` saves that
  // change and keeps absent terms `null` in a partial draft.
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

  // Update only this Organiser's drafts. If another user owns the id, update nothing.
  // Do not insert instead; one save must not create a second draft.
  const updated = await database
    .update(eventRequests)
    .set(fields)
    .where(ownDraft(id, user.id))
    .returning();

  if (updated.length === 0) {
    if (await ownRowExists(id, user.id, database)) {
      throw new ConflictError(SUBMITTED_EDIT_REFUSAL);
    }

    throw new AuthorizationError("Forbidden");
  }

  return updated[0];
}

/**
 * PTR-13: Submit the Organiser's draft. Refuse it if a required field is missing (criterion 1),
 * and record the submission time (criterion 2). PTR-144 supersedes PTR-15's auto-assign: the
 * request waits unassigned for a Lead, and the receipt and the Lead notices commit with it.
 *
 * Read the stored row, not the page's last values. This prevents a submission from including
 * unsaved data. Do not re-check PTR-11 registration terms: the save path requires all three terms
 * together, and database checks reject incomplete values.
 */
export async function handleSubmitEventRequest(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest> {
  const { id } = parseEventRequestId(data);

  // Lock the row while this transaction checks completeness and submits it. A save in another tab
  // must not clear a required field in between. The save path also refuses submitted rows, so it
  // waits here until this transaction commits.
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

    const now = new Date();
    const [submitted] = await tx
      .update(eventRequests)
      .set({
        status: "submitted",
        submittedAt: now,
        // PTR-144: a submission is never auto-assigned. The Lead allocates it from the queue.
        assignedCoordinatorId: null,
        assignedAt: null,
      })
      .where(ownDraft(id, user.id))
      .returning();

    // The submission, the Organiser's receipt, and the notices to every Lead commit together.
    const eventName = submitted.eventName.trim() || "Untitled request";
    const leadIds = await listLeadIds(tx);
    await raiseNotifications(tx, [
      {
        recipientId: user.id,
        eventRequestId: submitted.id,
        kind: "event_submitted",
        payload: { eventName, audience: "organiser" },
      },
      ...leadIds.map(recipientId => ({
        recipientId,
        eventRequestId: submitted.id,
        kind: "event_submitted" as const,
        payload: { eventName, audience: "lead" as const },
      })),
    ]);

    return submitted;
  });
}

/**
 * PTR-14 criterion 1: Return the Organiser's requests, including drafts. Sort by most recent change,
 * then by id, so rows saved at the same time keep a stable order.
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
 * PTR-14 criterion 4: Return one request as recorded. Scope it to the Organiser so another user's
 * row appears absent. The route uses the same not-found view for both cases, so ids cannot be probed.
 */
export async function handleGetEventRequest(
  data: unknown,
  organiser: SessionUser,
  database: Database
) {
  const { id } = parseEventRequestId(data);
  const rows = await database
    .select(withCoordinator)
    .from(eventRequests)
    .leftJoin(users, eq(users.id, eventRequests.assignedCoordinatorId))
    .where(ownRequest(id, organiser.id));
  const request = rows.at(0);
  if (!request) return null;

  const [clarifications, changeRequests, cancellationRequests] = await Promise.all([
    database
      .select()
      .from(clarificationRequests)
      .where(eq(clarificationRequests.eventRequestId, id))
      .orderBy(asc(clarificationRequests.createdAt)),
    listEventChangeRequests(id, database),
    listEventCancellationRequests(id, database),
  ]);

  return { ...request, clarifications, changeRequests, cancellationRequests };
}

/**
 * PTR-144 AC2/AC3: Return submitted requests with no assigned Coordinator, oldest first, with the
 * Organiser's details and the live change and cancellation requests. The unassigned queue is the
 * Event Coordinator Lead's read; submission no longer auto-assigns, so every fresh submission
 * appears here.
 */
export async function handleListUnassignedEventRequests(
  database: Database
): Promise<EventRequestWithOrganiser[]> {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: users.name, email: users.email },
      changeRequestsWaiting: changeRequestsWaitingSql(),
      cancellationRequested: cancellationRequestedSql(),
    })
    .from(eventRequests)
    .innerJoin(users, eq(users.id, eventRequests.organiserId))
    .where(and(ne(eventRequests.status, "draft"), isNull(eventRequests.assignedCoordinatorId)))
    .orderBy(asc(eventRequests.submittedAt), asc(eventRequests.id));
}
/**
 * Criterion 2: Load an owned draft to seed the edit form. Use `ownDraft`, as the save path does,
 * so the route cannot fetch a submitted request for editing. Return `null` for another user's row,
 * a submitted request, or a missing row. The route uses the same 404 for all three cases.
 */
export async function handleGetEventRequestDraft(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest | null> {
  const { id } = parseEventRequestId(data);

  const rows = await database.select().from(eventRequests).where(ownDraft(id, user.id));

  return rows.at(0) ?? null;
}

/**
 * Criterion 3: Delete the Organiser's draft. Use `ownDraft` so a submitted request cannot be
 * deleted. This matches `handleSaveEventRequestDraft`'s distinction between another user's row
 * and an owned row that is no longer a draft.
 */
export async function handleDeleteEventRequestDraft(
  data: unknown,
  user: SessionUser,
  database: Database
): Promise<EventRequest> {
  const { id } = parseEventRequestId(data);

  const deleted = await database.delete(eventRequests).where(ownDraft(id, user.id)).returning();

  if (deleted.length === 0) {
    if (await ownRowExists(id, user.id, database)) {
      throw new ConflictError(EVENT_REQUEST_DELETE_REFUSAL);
    }

    throw new AuthorizationError("Forbidden");
  }

  return deleted[0];
}

/**
 * PTR-154: Copy the Organiser's past request into a new draft. Copy the repeatable details
 * (AC1) and leave dates, registration, and every decided or arranged value behind (AC2).
 * Insert a new row, so the source row stays unchanged (AC4). Refuse another Organiser's row
 * like the other readers do (AC3), and refuse a request that is not past with 409.
 */
export async function handleReuseEventRequest(
  data: unknown,
  user: SessionUser,
  database: Database,
  now = new Date()
): Promise<EventRequest> {
  const { id } = parseEventRequestId(data);

  const rows = await database.select().from(eventRequests).where(ownRequest(id, user.id));
  const source = rows.at(0);
  if (!source) throw new AuthorizationError("Forbidden");

  // Read the event end from the proposed dates, as the completion gate does. A missing end
  // never counts as passed, so only a completed request without one qualifies.
  const { endDate, endTime } = eventTiming(source.proposedDates);
  const eventEnd = endDate && endTime ? `${endDate}T${endTime}` : null;
  if (!canReuseEventRequest(source.status, singaporeLocalEndHasPassed(eventEnd, now) === true)) {
    throw new ConflictError(EVENT_REQUEST_REUSE_REFUSAL);
  }

  const [draft] = await database
    .insert(eventRequests)
    .values({
      organiserId: user.id,
      status: "draft",
      eventName: source.eventName,
      purpose: source.purpose,
      proposedDates: [],
      expectedAttendance: source.expectedAttendance,
      description: source.description,
      eventType: "",
      venueRequirements: source.venueRequirements,
      roomLayoutPreference: source.roomLayoutPreference,
      accessibilityRequirements: source.accessibilityRequirements,
      equipmentRequirements: structuredClone(source.equipmentRequirements),
      specialArrangements: "",
      registrationEnabled: false,
      registrationCapacity: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    })
    .returning();

  return draft;
}
