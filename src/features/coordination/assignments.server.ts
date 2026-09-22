import { and, asc, desc, eq, getTableColumns, inArray, ne, or, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createElement } from "react";

import type { db as Db } from "#/db";
import { clarificationRequests, eventAssignments, eventRequests, user } from "#/db/schema";
import { env } from "#/env";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseAssignmentInput, parseDecisionInput } from "#/features/coordination/schema";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import { parseClarificationBody, parseEventRequestId } from "#/features/event-requests/schema";
import { logger } from "#/lib/logger";
import { sendEmail } from "#/lib/mailer.server";

const log = logger.getChild("coordination");

/**
 * Server-only on purpose, and named for it. `#/db/schema` is a value import here: the table
 * builders run at module scope, so a bundler cannot treat the module as side-effect free and
 * drops nothing — importing this from anywhere the browser can reach would ship the whole
 * database schema, Better Auth tables included. `server-fns.ts` reaches it through a dynamic
 * `import()` inside `.handler()`, which is the seam that keeps it off the client.
 *
 * The middleware pipeline has already verified the session and `event_request:coordinate`
 * before these handlers run.
 */

type Database = typeof Db;

const organisers = alias(user, "organiser");
const coordinators = alias(user, "coordinator");

export async function handleListAssignedEventRequests(actor: SessionUser, database: Database) {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: user.name, email: user.email },
    })
    .from(eventRequests)
    .innerJoin(user, eq(user.id, eventRequests.organiserId))
    .where(
      and(ne(eventRequests.status, "draft"), eq(eventRequests.assignedCoordinatorId, actor.id))
    )
    .orderBy(desc(eventRequests.assignedAt), desc(eventRequests.id));
}

export async function handleListCoordinators(database: Database) {
  return database
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.role, "event_coordinator"))
    .orderBy(asc(user.name), asc(user.id));
}

/** Re-reads ownership on every request; a previous assignment never confers access. */
export async function handleGetCoordinationRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseEventRequestId(data);
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
        or(
          isNull(eventRequests.assignedCoordinatorId),
          eq(eventRequests.assignedCoordinatorId, actor.id)
        )
      )
    );
  const request = rows.at(0);
  if (!request)
    throw new AuthorizationError(
      "You no longer have coordination access to this request, or it is unavailable."
    );

  const clarifications = await database
    .select()
    .from(clarificationRequests)
    .where(eq(clarificationRequests.eventRequestId, id))
    .orderBy(asc(clarificationRequests.createdAt));

  return {
    ...request,
    clarifications,
  };
}

/** The row lock serialises pickups and handovers; all effects either commit together or roll back. */
export async function handleAssignEventRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAssignmentInput(data);
  return database.transaction(async tx => {
    const rows = await tx
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, input.id))
      .for("update");
    const request = rows.at(0);
    if (
      !request ||
      request.status === "draft" ||
      (request.assignedCoordinatorId !== null && request.assignedCoordinatorId !== actor.id)
    ) {
      throw new AuthorizationError(
        "Only the assigned Coordinator can reassign this request. Unassigned requests can be picked up by any Event Coordinator."
      );
    }
    if (request.assignedCoordinatorId !== input.expectedCoordinatorId) {
      throw new ConflictError("This assignment has changed. Refresh the request and try again.");
    }
    if (request.status === "approved" || request.status === "rejected") {
      throw new ConflictError("A decided request can no longer be reassigned.");
    }
    if (request.assignedCoordinatorId === input.coordinatorId) {
      throw new ConflictError("This Coordinator is already assigned to the request.");
    }

    // Hold the selected account while its role is validated and the assignment is committed.
    const incoming = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.coordinatorId), eq(user.role, "event_coordinator")))
        .for("share")
    ).at(0);
    if (!incoming) throw new ConflictError("Choose an existing Event Coordinator.");

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
 * decision commits before the Organiser's email is attempted; a failed send is logged, not
 * fatal, so a mail outage cannot lose a recorded decision.
 */
export async function handleDecideEventRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseDecisionInput(data);
  const { recorded, organiserEmail } = await database.transaction(async tx => {
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

    return {
      recorded: updated,
      organiserEmail: requestOrganiser.email,
    };
  });

  try {
    await sendEmail(
      organiserEmail,
      `Your event request was ${input.decision}`,
      createElement(EventDecisionEmail, {
        eventName: recorded.eventName.trim() || "Untitled request",
        decision: input.decision,
        reason: input.reason,
        eventRequestUrl: `${env.BETTER_AUTH_URL}/event-requests/${recorded.id}`,
      })
    );
  } catch (error) {
    // The decision is already committed; a failed notification must not lose it (matches PTR-18).
    log.warn("Decision email failed", {
      requestId: recorded.id,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
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
  const { clarification, organiserEmail, eventName } = await database.transaction(async tx => {
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
      })
      .returning();

    await tx
      .update(eventRequests)
      .set({ status: "awaiting_organiser" })
      .where(eq(eventRequests.id, request.id));

    const [organiser] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, request.organiserId));

    return {
      clarification: inserted,
      organiserEmail: organiser.email,
      eventName: request.eventName,
    };
  });

  const displayName = eventName.trim() || "Untitled request";

  try {
    await sendEmail(
      organiserEmail,
      `Clarification requested: ${displayName}`,
      createElement(ClarificationRequestEmail, {
        eventName: displayName,
        body: input.body,
        eventRequestUrl: `${env.BETTER_AUTH_URL}/event-requests/${clarification.eventRequestId}`,
      })
    );
  } catch (error) {
    // Email failure does not roll back the recorded clarification
    log.warn("Clarification email failed", {
      requestId: input.id,
      clarificationId: clarification.id,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return clarification;
}
