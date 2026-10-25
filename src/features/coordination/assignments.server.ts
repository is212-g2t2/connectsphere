import { and, asc, desc, eq, getTableColumns, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import {
  clarificationRequests,
  eventAssignments,
  equipmentRequests,
  eventRequests,
  user,
} from "#/db/schema";
import { can } from "#/features/auth/permissions";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { listEventCancellationRequests } from "#/features/event-requests/cancellation-requests.server";
import {
  changeRequestsWaitingSql,
  listEventChangeRequests,
} from "#/features/event-requests/change-requests.server";
import { listEventInformationChanges } from "#/features/event-requests/information-changes.server";
import { loadOutstandingReleases } from "#/features/events/arrangements.server";
import { hasBlockedArrangementSql } from "#/features/venues/blocked-arrangements.server";
import { loadVenueRequestsForEvent } from "#/features/venue-requests/records.server";
import { parseAssignmentInput, parseDecisionInput } from "#/features/coordination/schema";
import {
  canAssignEventRequest,
  EQUIPMENT_MAX_LINES,
  parseClarificationBody,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";

/**
 * Server-only on purpose, and named for it. `#/db/schema` is a value import here: the table
 * builders run at module scope, so a bundler cannot treat the module as side-effect free and
 * drops nothing — importing this from anywhere the browser can reach would ship the whole
 * database schema, Better Auth tables included. `server-fns.ts` reaches it through a dynamic
 * `import()` inside `.handler()`, which is the seam that keeps it off the client.
 *
 * The middleware pipeline has already verified the session and a permission before these handlers
 * run: `event_request:coordinate` for every coordination action, and `event_request:oversee` for
 * the Lead's read-only request detail (PTR-144).
 */

type Database = typeof Db;

const organisers = alias(user, "organiser");
const coordinators = alias(user, "coordinator");

export async function handleListAssignedEventRequests(actor: SessionUser, database: Database) {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: user.name, email: user.email },
      /** PTR-137 AC1: a live venue block has suspended one of the event's bookings or holds. */
      venueBlocked: hasBlockedArrangementSql(eventRequests.id, eventRequests.status),
      /** PTR-52 AC1: the Organiser's change requests still waiting on this Coordinator. */
      changeRequestsWaiting: changeRequestsWaitingSql(),
    })
    .from(eventRequests)
    .innerJoin(user, eq(user.id, eventRequests.organiserId))
    .where(
      and(ne(eventRequests.status, "draft"), eq(eventRequests.assignedCoordinatorId, actor.id))
    )
    .orderBy(desc(eventRequests.assignedAt), desc(eventRequests.id));
}

/**
 * PTR-145 criterion 6: every Event Coordinator, unfiltered and unranked. A Lead may choose any
 * of them; no availability or workload rule narrows the list.
 */
export async function handleListCoordinators(database: Database) {
  return database
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.role, "event_coordinator"))
    .orderBy(asc(user.name), asc(user.id));
}

type CoordinatorOversightEvent = {
  id: number;
  eventName: string;
  status: EventRequestStatus;
  assignedAt: Date | null;
};

/**
 * PTR-149 criterion 1: every Event Coordinator with every assigned event, system-wide. A
 * Coordinator with no events still appears, so the Lead sees the whole team. Drafts are never
 * assigned and stay out. The page decides which events are active with `isActiveEventRequest`.
 */
export async function handleListCoordinatorOversight(database: Database) {
  const rows = await database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      eventId: eventRequests.id,
      eventName: eventRequests.eventName,
      status: eventRequests.status,
      assignedAt: eventRequests.assignedAt,
    })
    .from(user)
    .leftJoin(
      eventRequests,
      and(eq(eventRequests.assignedCoordinatorId, user.id), ne(eventRequests.status, "draft"))
    )
    .where(eq(user.role, "event_coordinator"))
    .orderBy(asc(user.name), asc(user.id), desc(eventRequests.assignedAt), desc(eventRequests.id));

  const byCoordinator = new Map<
    string,
    { id: string; name: string; email: string; events: CoordinatorOversightEvent[] }
  >();
  for (const row of rows) {
    let coordinator = byCoordinator.get(row.id);
    if (!coordinator) {
      coordinator = { id: row.id, name: row.name, email: row.email, events: [] };
      byCoordinator.set(row.id, coordinator);
    }
    if (row.eventId !== null && row.eventName !== null && row.status !== null) {
      coordinator.events.push({
        id: row.eventId,
        eventName: row.eventName,
        status: row.status,
        assignedAt: row.assignedAt,
      });
    }
  }
  return [...byCoordinator.values()];
}

/**
 * Re-reads ownership on every request; a previous assignment never confers access. The assigned
 * Coordinator reads their own assignment. PTR-144: a caller with `event_request:oversee` (the
 * Lead) reads every non-draft request, assigned or not. PTR-145 uses that same read for the
 * assignment form, which needs the current holder. A coordinator is refused an unassigned
 * request — the id space reveals nothing about the queue.
 */
export async function handleGetCoordinationRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseEventRequestId(data);
  // The permission decides the scope, not the role literal: the verb has one owner today, and
  // this reads the same source of truth as the middleware.
  const readsQueue = can(actor.role, { event_request: ["oversee"] });
  const rows = await database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: organisers.name, email: organisers.email },
      coordinator: { name: coordinators.name, email: coordinators.email },
    })
    .from(eventRequests)
    .innerJoin(organisers, eq(organisers.id, eventRequests.organiserId))
    .leftJoin(coordinators, eq(coordinators.id, eventRequests.assignedCoordinatorId))
    .where(
      and(
        eq(eventRequests.id, id),
        ne(eventRequests.status, "draft"),
        readsQueue ? undefined : eq(eventRequests.assignedCoordinatorId, actor.id)
      )
    );
  const request = rows.at(0);
  // "Forbidden" is the refusal the event page's fallback reads: a hidden, foreign, or
  // nonexistent request answers the same 404, and the message carries no request data.
  if (!request) throw new AuthorizationError("Forbidden");

  // PTR-145: the reassignment form reads only the holder of an assigned request, so the Lead's
  // read skips the review-flow sub-reads it would not render. The queue detail (unassigned) and
  // the Coordinator's own view keep them.
  const reviewFlow =
    readsQueue && request.assignedCoordinatorId !== null
      ? null
      : await Promise.all([
          database
            .select()
            .from(clarificationRequests)
            .where(eq(clarificationRequests.eventRequestId, id))
            .orderBy(asc(clarificationRequests.createdAt)),
          listEventChangeRequests(id, database),
          listEventCancellationRequests(id, database),
          // PTR-54 AC2: what a cancelled event still holds, read live so a release takes it off.
          request.status === "cancelled" ? loadOutstandingReleases(database, id) : null,
          // The triage venue section reads the event's live venue requests from here.
          loadVenueRequestsForEvent(database, id),
          // PTR-164 AC3: the change log with its significant-change reasons.
          listEventInformationChanges(id, database),
        ]);

  // PTR-164 AC1/AC3: the free-text reasons name only the Organiser and the assigned
  // Coordinator. The Lead's queue read keeps the waiting requests but not the decided reasons or
  // the change log, so an event back in the unassigned queue shows no reason.
  const coordinatorRead = !readsQueue;
  return {
    ...request,
    clarifications: reviewFlow?.[0] ?? [],
    changeRequests: reviewFlow?.[1] ?? [],
    cancellationRequests: coordinatorRead
      ? (reviewFlow?.[2] ?? [])
      : (reviewFlow?.[2] ?? []).filter(item => item.outcome === null),
    outstandingReleases: reviewFlow?.[3] ?? null,
    venueRequests: reviewFlow?.[4] ?? [],
    informationChanges: coordinatorRead ? (reviewFlow?.[5] ?? []) : [],
  };
}

/**
 * PTR-145: the Lead assigns an unassigned request, or reassigns an assigned one. The move takes
 * effect at once; the incoming Coordinator never accepts or declines. The candidate recipients
 * are locked in one order, then the request row: two Leads cannot act on the same observation,
 * so the later call sees the first move and refuses a stale expected Coordinator without changing
 * anything (criterion 8).
 *
 * A request from submission through confirmation is assignable. A draft, a rejected request, a
 * completed event and a cancelled event are closed (criterion 3). The audit row records the
 * acting Lead and the time (criterion 7). The notifications commit with the move: the incoming
 * Coordinator and the Organiser hear of every move, and the outgoing Coordinator hears of a
 * reassignment (criteria 1 and 2).
 */
export async function handleAssignEventRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAssignmentInput(data);

  return database.transaction(async tx => {
    // Lock the candidate recipient accounts in one id order before the event row. An account
    // deletion takes a user row first and the request row second (through its FK action), so
    // locking users first keeps that inversion from deadlocking the assignment. The pre-read is
    // unlocked; the row lock below re-validates the holder it names.
    const preRead = (
      await tx
        .select({ organiserId: eventRequests.organiserId })
        .from(eventRequests)
        .where(eq(eventRequests.id, input.id))
    ).at(0);
    if (!preRead) throw new NotFoundError("Not Found");
    // The outgoing account on success is the expected one (checked under the row lock), so the
    // expected id, not the pre-read holder, is the row the notification insert will reference.
    const recipientIds = [
      ...new Set(
        [input.coordinatorId, preRead.organiserId, input.expectedCoordinatorId].filter(
          (id): id is string => id !== null
        )
      ),
    ].toSorted();
    await tx
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, recipientIds))
      .orderBy(asc(user.id))
      .for("share");

    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);
    if (!request) throw new NotFoundError("Not Found");

    // AC3 first: a closed request names its own refusal, even from a stale page.
    if (!canAssignEventRequest(request.status)) {
      throw new ConflictError("This request can no longer be assigned.");
    }
    // Refuse a stale page before any write: the Lead saw a different holder.
    if (request.assignedCoordinatorId !== input.expectedCoordinatorId) {
      throw new ConflictError("This assignment has changed. Refresh the request and try again.");
    }
    if (request.assignedCoordinatorId === input.coordinatorId) {
      throw new ConflictError("This Coordinator is already assigned to the request.");
    }

    // The recipient lock above holds the incoming account while its role is validated and the
    // assignment is committed.
    const incoming = (
      await tx
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(and(eq(user.id, input.coordinatorId), eq(user.role, "event_coordinator")))
    ).at(0);
    if (!incoming) throw new ConflictError("Choose an existing Event Coordinator.");

    // A deleted Coordinator leaves the request unassigned, so this read is absent on an assign.
    const outgoing = request.assignedCoordinatorId
      ? (
          await tx
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(eq(user.id, request.assignedCoordinatorId))
        ).at(0)
      : undefined;

    const action = request.assignedCoordinatorId === null ? "assign" : "reassign";
    const now = new Date();
    const [updated] = await tx
      .update(eventRequests)
      .set({ assignedCoordinatorId: incoming.id, assignedAt: now })
      .where(eq(eventRequests.id, request.id))
      .returning();

    await tx.insert(eventAssignments).values({
      eventRequestId: request.id,
      fromCoordinatorId: request.assignedCoordinatorId,
      toCoordinatorId: incoming.id,
      actorId: actor.id,
      createdAt: now,
    });

    const eventName = updated.eventName.trim() || "Untitled request";
    const coordinatorName = incoming.name;
    const previousCoordinatorName = outgoing?.name ?? undefined;
    const shared = {
      eventName,
      action,
      coordinatorName,
      ...(previousCoordinatorName ? { previousCoordinatorName } : {}),
    } as const;

    const rows: NewNotification[] = [
      {
        recipientId: incoming.id,
        eventRequestId: request.id,
        kind: "coordinator_assigned",
        payload: { ...shared, audience: "coordinator" },
      },
      {
        recipientId: request.organiserId,
        eventRequestId: request.id,
        kind: "coordinator_assigned",
        payload: { ...shared, audience: "organiser" },
      },
    ];
    if (request.assignedCoordinatorId !== null) {
      rows.push({
        recipientId: request.assignedCoordinatorId,
        eventRequestId: request.id,
        kind: "coordinator_assigned",
        payload: { ...shared, audience: "outgoing_coordinator" },
      });
    }
    await raiseNotifications(tx, rows);

    return updated;
  });
}

/**
 * PTR-17 criterion 3: the assigned Coordinator marks a submitted request as under review. Only
 * the current assignee can take it up; an unassigned or differently-assigned request is refused
 * with 403 so the id space reveals nothing about other coordinators' work.
 *
 * A request that is already `under_review` is refused with 409: the button is hidden once the
 * transition has occurred, so a repeat call means a stale page or a direct API call.
 *
 * The guarded UPDATE runs first so the precondition is enforced atomically; the follow-up read
 * only classifies why the update matched nothing.
 */
export async function handleTakeUpForReview(data: unknown, actor: SessionUser, database: Database) {
  const { id } = parseEventRequestId(data);

  const taken = await database
    .update(eventRequests)
    .set({ status: "under_review" })
    .where(
      and(
        eq(eventRequests.id, id),
        eq(eventRequests.assignedCoordinatorId, actor.id),
        eq(eventRequests.status, "submitted")
      )
    )
    .returning();
  const updated = taken.at(0);
  if (updated) return updated;

  const rows = await database
    .select({
      status: eventRequests.status,
      assignedCoordinatorId: eventRequests.assignedCoordinatorId,
    })
    .from(eventRequests)
    .where(eq(eventRequests.id, id));
  const request = rows.at(0);
  if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
    throw new AuthorizationError(
      "Only the assigned Coordinator can take this request up for review."
    );
  }
  if (request.status === "under_review") {
    throw new ConflictError("This request is already under review.");
  }

  // Reachable when the row moved between the guarded UPDATE and this read, for example it was assigned to the actor meanwhile.
  throw new ConflictError(
    "This request changed while you were taking it up. Refresh and try again."
  );
}

/**
 * PTR-20: record one terminal decision against a request held by the assigned Coordinator. The
 * row lock makes competing approval/rejection calls serialize, so exactly one can win. The
 * decision and the Organiser's notification commit together; the worker delivers the email.
 */
export async function handleDecideEventRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseDecisionInput(data);
  const recorded = await database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);

    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Only the assigned Coordinator can decide this request.");
    }
    if (request.status === "approved" || request.status === "rejected") {
      throw new ConflictError("This request already has a recorded decision.");
    }
    if (request.status !== "under_review") {
      throw new ConflictError("Take this request up for review before deciding it.");
    }

    const people = await tx
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, [actor.id, request.organiserId]));
    const decidingCoordinator = people.find(person => person.id === actor.id);
    const requestOrganiser = people.find(person => person.id === request.organiserId);
    if (!decidingCoordinator || !requestOrganiser) {
      throw new ConflictError("The request's Coordinator or Organiser is no longer available.");
    }

    const now = new Date();
    const [updated] = await tx
      .update(eventRequests)
      .set({
        status: input.decision,
        decisionReason: input.reason || null,
        decidedByCoordinatorId: actor.id,
        decidedByCoordinatorName: decidingCoordinator.name,
        decidedAt: now,
      })
      .where(eq(eventRequests.id, request.id))
      .returning();

    // PTR-38 AC2: an approval seeds the Coordinator's equipment panel from the organiser's
    // original draft lines. Only lines with a type and a positive integer quantity are carried
    // over; blank, half-typed or otherwise invalid rows the draft kept while editing are skipped,
    // so a bad draft row never aborts the approval. This runs inside the same transaction so the
    // rows are visible the moment the event becomes `approved`.
    if (input.decision === "approved") {
      const draftLines = request.equipmentRequirements
        .filter(
          (line): line is { type: string; quantity: number } =>
            typeof line.type === "string" &&
            line.type.trim() !== "" &&
            typeof line.quantity === "number" &&
            Number.isInteger(line.quantity) &&
            line.quantity > 0 &&
            line.quantity <= 2_147_483_647
        )
        // A legacy row saved before the draft cap could carry more lines than the panel allows;
        // seed only the first window so the panel's invariant holds.
        .slice(0, EQUIPMENT_MAX_LINES);
      if (draftLines.length > 0) {
        await tx.insert(equipmentRequests).values(
          draftLines.map(line => ({
            id: crypto.randomUUID(),
            eventId: request.id,
            item: line.type.trim(),
            quantity: line.quantity,
            notes: null,
          }))
        );
      }
    }

    // The decision and the Organiser's notification commit together; the worker sends it.
    await raiseNotifications(tx, [
      {
        recipientId: requestOrganiser.id,
        eventRequestId: updated.id,
        kind: "event_decided",
        payload: {
          eventName: updated.eventName.trim() || "Untitled request",
          decision: input.decision,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      },
    ]);

    return updated;
  });

  return recorded;
}

/**
 * PTR-18: the assigned Coordinator raises a clarification request for an event under review.
 * Updates status to awaiting_organiser and notifies the organiser via email (§6).
 * Multiple clarification requests are accepted alongside existing ones (AC5 / Option A).
 */
export async function handleRaiseClarificationRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseClarificationBody(data);
  const clarification = await database.transaction(async tx => {
    const rows = await tx
      .select({
        id: eventRequests.id,
        eventName: eventRequests.eventName,
        status: eventRequests.status,
        assignedCoordinatorId: eventRequests.assignedCoordinatorId,
        organiserId: eventRequests.organiserId,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, input.id))
      .for("update");
    const request = rows.at(0);
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError(
        "Only the assigned Coordinator can request clarification for this event."
      );
    }
    if (request.status !== "under_review" && request.status !== "awaiting_organiser") {
      throw new ConflictError(
        "Clarification can only be requested for events that are under review."
      );
    }

    const [inserted] = await tx
      .insert(clarificationRequests)
      .values({
        eventRequestId: request.id,
        coordinatorId: actor.id,
        body: input.body,
        permittedFields: input.permittedFields,
      })
      .returning();

    await tx
      .update(eventRequests)
      .set({ status: "awaiting_organiser" })
      .where(eq(eventRequests.id, request.id));

    // The clarification and its notification commit together; the worker sends the email.
    await raiseNotifications(tx, [
      {
        recipientId: request.organiserId,
        eventRequestId: request.id,
        kind: "clarification_requested",
        payload: {
          eventName: request.eventName.trim() || "Untitled request",
          body: input.body,
        },
      },
    ]);

    return inserted;
  });

  return clarification;
}
