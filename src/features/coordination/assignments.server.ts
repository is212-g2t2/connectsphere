import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  ne,
  notInArray,
  or,
  isNull,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createElement } from "react";

import type { db as Db } from "#/db";
import {
  clarificationRequests,
  eventAssignments,
  eventHandovers,
  equipmentRequests,
  eventRequests,
  user,
} from "#/db/schema";
import { env } from "#/env";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  parseAssignmentInput,
  parseDecisionInput,
  parseEventHandoverId,
} from "#/features/coordination/schema";
import { EventDecisionEmail } from "#/features/emails/components/event-decision-email";
import { HandoverAcceptedEmail } from "#/features/emails/components/handover-accepted-email";
import { HandoverDeclinedEmail } from "#/features/emails/components/handover-declined-email";
import { HandoverRequestEmail } from "#/features/emails/components/handover-request-email";
import { ClarificationRequestEmail } from "#/features/emails/components/clarification-request-email";
import {
  EQUIPMENT_MAX_LINES,
  parseClarificationBody,
  parseEventRequestId,
} from "#/features/event-requests/schema";
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
const handoverTargets = alias(user, "handover_target");
const handoverSenders = alias(user, "handover_sender");

/**
 * One refusal for a handover that does not exist and one that is addressed to someone else: the
 * serial id space must not tell a Coordinator whether another Coordinator holds a live offer.
 */
const HANDOVER_NOT_ANSWERABLE = "This handover is not available to answer.";

export async function handleListAssignedEventRequests(actor: SessionUser, database: Database) {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: user.name, email: user.email },
      /** PTR-110: the Coordinator a live handover waits on, so the list can say so. */
      handoverTo: handoverTargets.name,
    })
    .from(eventRequests)
    .innerJoin(user, eq(user.id, eventRequests.organiserId))
    .leftJoin(
      eventHandovers,
      and(
        eq(eventHandovers.eventRequestId, eventRequests.id),
        isNull(eventHandovers.decision),
        // Only the current assignment's offer counts: a row left behind by an account deletion
        // and a later pick-up must not label the new Coordinator's request, and a decided
        // request's offer can never be taken up.
        eq(eventHandovers.fromCoordinatorId, eventRequests.assignedCoordinatorId),
        notInArray(eventRequests.status, ["approved", "rejected"])
      )
    )
    .leftJoin(handoverTargets, eq(handoverTargets.id, eventHandovers.toCoordinatorId))
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

  // PTR-110: the live offer, but only while it is still this assignment's offer — the outgoing
  // Coordinator sees it and cannot raise a second one. A row the current assignment has moved
  // past (account deletion and a later pick-up), one on a decided request, or one whose incoming
  // account no longer exists (the inner join) is not shown as if it still waited.
  const assignedCoordinatorId = request.assignedCoordinatorId;

  let pendingHandover: { requestedAt: Date; toName: string } | null = null;
  if (
    assignedCoordinatorId !== null &&
    request.status !== "approved" &&
    request.status !== "rejected"
  ) {
    pendingHandover =
      (
        await database
          .select({
            requestedAt: eventHandovers.requestedAt,
            toName: handoverTargets.name,
          })
          .from(eventHandovers)
          .innerJoin(handoverTargets, eq(handoverTargets.id, eventHandovers.toCoordinatorId))
          .where(
            and(
              eq(eventHandovers.eventRequestId, id),
              isNull(eventHandovers.decision),
              eq(eventHandovers.fromCoordinatorId, assignedCoordinatorId)
            )
          )
      ).at(0) ?? null;
  }

  return {
    ...request,
    clarifications,
    pendingHandover,
  };
}

/** The direct move is gone; an assigned request changes hands only by accepted handover. */
export const ASSIGNED_REQUEST_HANDOVER_MESSAGE =
  "This request is assigned. Offer it as a handover and wait for that Coordinator to accept.";

/**
 * Pick-up only: any Event Coordinator assigns an unassigned request to themselves or a named
 * Coordinator, immediately and with its audit row. An assigned request never moves here — the
 * accepted handover is the one path (`handleRequestEventHandover`), so the incoming Coordinator
 * always agrees before the event changes hands. A stranger probing an assigned id is refused the
 * same way the detail read refuses them; its own Coordinator is told to use the handover. A
 * decided request that lost its Coordinator (the account was deleted, which sets the assignment
 * null) is closed work, not a pick-up. The row lock serialises competing pick-ups; all effects
 * either commit together or roll back.
 */
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
        "Only an unassigned request can be picked up here; an assigned request is handed over by its Coordinator."
      );
    }
    if (request.assignedCoordinatorId !== null) {
      throw new ConflictError(ASSIGNED_REQUEST_HANDOVER_MESSAGE);
    }
    if (request.status === "approved" || request.status === "rejected") {
      throw new ConflictError("A decided request can no longer be assigned.");
    }
    // The request is unassigned, so the only observation a stale page can hold is a Coordinator
    // who has since been removed; `null` is the one value that matches.
    if (input.expectedCoordinatorId !== null) {
      throw new ConflictError("This assignment has changed. Refresh the request and try again.");
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
 * PTR-110 criterion 1: the assigned Coordinator offers the request to a named Event Coordinator.
 * The offer is a pending row; the outgoing Coordinator stays assigned and keeps access (criterion
 * 2) until the incoming one answers. Raising again replaces the live offer, so a change of mind
 * neither leaves two offers waiting nor blocks the event forever. The row lock serialises raises,
 * and the partial unique index is the backstop.
 *
 * The incoming Coordinator is emailed after the commit, best effort like every other notification.
 */
export async function handleRequestEventHandover(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAssignmentInput(data);

  const raised = await database.transaction(async tx => {
    const request = (
      await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
    ).at(0);
    if (!request || request.status === "draft" || request.assignedCoordinatorId !== actor.id) {
      throw new AuthorizationError("Only the assigned Coordinator can hand this request over.");
    }
    if (request.assignedCoordinatorId !== input.expectedCoordinatorId) {
      throw new ConflictError("This assignment has changed. Refresh the request and try again.");
    }
    if (request.status === "approved" || request.status === "rejected") {
      throw new ConflictError("A decided request can no longer be handed over.");
    }
    if (request.assignedCoordinatorId === input.coordinatorId) {
      throw new ConflictError("This Coordinator is already assigned to the request.");
    }

    // Hold the selected account while its role is validated and the offer is committed.
    const incoming = (
      await tx
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(and(eq(user.id, input.coordinatorId), eq(user.role, "event_coordinator")))
        .for("share")
    ).at(0);
    if (!incoming) throw new ConflictError("Choose an existing Event Coordinator.");

    await tx
      .delete(eventHandovers)
      .where(and(eq(eventHandovers.eventRequestId, request.id), isNull(eventHandovers.decision)));
    const [handover] = await tx
      .insert(eventHandovers)
      .values({
        eventRequestId: request.id,
        fromCoordinatorId: actor.id,
        toCoordinatorId: incoming.id,
      })
      .returning();

    return { handover, incomingEmail: incoming.email, eventName: request.eventName };
  });

  const displayName = raised.eventName.trim() || "Untitled request";
  try {
    await sendEmail(
      raised.incomingEmail,
      `Handover requested: ${displayName}`,
      createElement(HandoverRequestEmail, {
        eventName: displayName,
        fromName: actor.name ?? actor.email,
        coordinationUrl: `${env.BETTER_AUTH_URL}/coordination`,
      })
    );
  } catch (error) {
    // The offer is committed; a failed notification must not lose it.
    log.warn("Handover request email failed", {
      requestId: input.id,
      handoverId: raised.handover.id,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return raised.handover;
}

/**
 * PTR-110 criterion 3: the incoming Coordinator accepts, and the assignment moves to them with
 * exactly one assigned Coordinator. The handover row lock settles accept-versus-decline exactly
 * once; the request row lock makes the move and its audit entry atomic with the decision.
 *
 * Locks are taken in the same order as a raise (request, then handover): the unlocked read learns
 * which request to lock first and refuses anyone but the addressee before a lock is taken, so a
 * concurrent raise cannot deadlock against an accept and a wrong actor cannot lock another
 * assignment. An offer whose request moved on (the account was deleted and the request picked up
 * again) is resolved as declined — that still records who answered and when — and refused
 * with 409.
 *
 * The Organiser is emailed after the commit, best effort.
 */
export async function handleAcceptEventHandover(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseEventHandoverId(data);

  const outcome = await database.transaction(async tx => {
    const offer = (
      await tx
        .select({
          eventRequestId: eventHandovers.eventRequestId,
          toCoordinatorId: eventHandovers.toCoordinatorId,
        })
        .from(eventHandovers)
        .where(eq(eventHandovers.id, id))
    ).at(0);
    // Refuse a wrong actor before taking any lock: an addressee check only under the locks would
    // let any Coordinator briefly lock another assignment by presenting a guessed live id.
    if (!offer || offer.toCoordinatorId !== actor.id) {
      throw new AuthorizationError(HANDOVER_NOT_ANSWERABLE);
    }

    const request = (
      await tx
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, offer.eventRequestId))
        .for("update")
    ).at(0);
    if (!request) throw new NotFoundError("Not Found");

    // Hold the accepting account while the assignment references it: a deletion racing this
    // accept would otherwise surface a raw FK violation instead of a refusal. User before
    // handover keeps the request → user → handover order the raise path uses.
    const accepting = (
      await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.id)).for("share")
    ).at(0);
    if (!accepting) throw new ConflictError("Your account is no longer available.");

    const handover = (
      await tx.select().from(eventHandovers).where(eq(eventHandovers.id, id)).for("update")
    ).at(0);
    if (!handover || handover.toCoordinatorId !== actor.id) {
      throw new AuthorizationError(HANDOVER_NOT_ANSWERABLE);
    }
    if (handover.decision !== null) {
      throw new ConflictError("This handover has already been answered.");
    }

    const now = new Date();
    if (
      request.assignedCoordinatorId !== handover.fromCoordinatorId ||
      request.status === "draft" ||
      request.status === "approved" ||
      request.status === "rejected"
    ) {
      const [voided] = await tx
        .update(eventHandovers)
        .set({ decision: "declined", decidedById: actor.id, decidedAt: now })
        .where(eq(eventHandovers.id, handover.id))
        .returning();
      return { kind: "void" as const, handover: voided };
    }

    const [updated] = await tx
      .update(eventRequests)
      .set({ assignedCoordinatorId: actor.id, assignedAt: now })
      .where(eq(eventRequests.id, request.id))
      .returning();
    await tx.insert(eventAssignments).values({
      eventRequestId: request.id,
      fromCoordinatorId: handover.fromCoordinatorId,
      toCoordinatorId: actor.id,
      actorId: actor.id,
      createdAt: now,
    });
    const [answered] = await tx
      .update(eventHandovers)
      .set({ decision: "accepted", decidedById: actor.id, decidedAt: now })
      .where(eq(eventHandovers.id, handover.id))
      .returning();

    const [organiser] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, request.organiserId));

    return {
      kind: "accepted" as const,
      handover: answered,
      request: updated,
      organiserEmail: organiser.email,
    };
  });

  if (outcome.kind === "void") {
    throw new ConflictError("This handover is no longer valid because the request has moved on.");
  }

  const displayName = outcome.request.eventName.trim() || "Untitled request";
  try {
    await sendEmail(
      outcome.organiserEmail,
      `Your event request has a new Coordinator: ${displayName}`,
      createElement(HandoverAcceptedEmail, {
        eventName: displayName,
        coordinatorName: actor.name ?? actor.email,
        eventRequestUrl: `${env.BETTER_AUTH_URL}/event-requests/${outcome.request.id}`,
      })
    );
  } catch (error) {
    // The new assignment is committed; a failed notification must not undo it.
    log.warn("Handover accepted email failed", {
      requestId: outcome.request.id,
      handoverId: outcome.handover.id,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }

  return outcome.handover;
}

/**
 * PTR-110 criterion 4: the incoming Coordinator declines. The event stays with the outgoing
 * Coordinator, the outgoing one is notified, and the answer records the acting user and the time.
 * Declining changes no assignment and must not take the request lock after the handover lock:
 * that order would reintroduce the raise-versus-decline deadlock the accept path avoids.
 */
export async function handleDeclineEventHandover(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseEventHandoverId(data);

  const answered = await database.transaction(async tx => {
    // Refuse a wrong actor before taking the row lock, matching accept: a guessed live id must
    // not let any Coordinator lock another Coordinator's offer.
    const offer = (
      await tx
        .select({ toCoordinatorId: eventHandovers.toCoordinatorId })
        .from(eventHandovers)
        .where(eq(eventHandovers.id, id))
    ).at(0);
    if (!offer || offer.toCoordinatorId !== actor.id) {
      throw new AuthorizationError(HANDOVER_NOT_ANSWERABLE);
    }

    const handover = (
      await tx.select().from(eventHandovers).where(eq(eventHandovers.id, id)).for("update")
    ).at(0);
    if (!handover || handover.toCoordinatorId !== actor.id) {
      throw new AuthorizationError(HANDOVER_NOT_ANSWERABLE);
    }
    if (handover.decision !== null) {
      throw new ConflictError("This handover has already been answered.");
    }

    const [declined] = await tx
      .update(eventHandovers)
      .set({ decision: "declined", decidedById: actor.id, decidedAt: new Date() })
      .where(eq(eventHandovers.id, handover.id))
      .returning();

    const [request] = await tx
      .select({
        eventName: eventRequests.eventName,
        assignedCoordinatorId: eventRequests.assignedCoordinatorId,
        outgoingEmail: user.email,
      })
      .from(eventRequests)
      .leftJoin(user, eq(user.id, handover.fromCoordinatorId))
      .where(eq(eventRequests.id, handover.eventRequestId))
      .limit(1);

    return {
      handover: declined,
      eventName: request.eventName,
      // Only tell the outgoing Coordinator they keep the request when they actually do: an offer
      // the request has already moved past is resolved silently.
      outgoingEmail:
        request.assignedCoordinatorId === handover.fromCoordinatorId ? request.outgoingEmail : null,
    };
  });

  if (answered.outgoingEmail !== null) {
    const displayName = answered.eventName.trim() || "Untitled request";
    try {
      await sendEmail(
        answered.outgoingEmail,
        `Handover declined: ${displayName}`,
        createElement(HandoverDeclinedEmail, {
          eventName: displayName,
          coordinatorName: actor.name ?? actor.email,
          eventRequestUrl: `${env.BETTER_AUTH_URL}/coordination/${answered.handover.eventRequestId}`,
        })
      );
    } catch (error) {
      // The offer is settled; a failed notification must not undo the answer.
      log.warn("Handover declined email failed", {
        requestId: answered.handover.eventRequestId,
        handoverId: answered.handover.id,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  return answered.handover;
}

/**
 * PTR-110: the live handover offers addressed to the signed-in Coordinator, oldest first, with
 * what they need to answer: the event, its Organiser, and who is offering it. Only answerable
 * offers list: one the request has moved past, or one on a decided request, is not shown.
 */
export async function handleListPendingEventHandovers(actor: SessionUser, database: Database) {
  return database
    .select({
      id: eventHandovers.id,
      requestedAt: eventHandovers.requestedAt,
      eventName: eventRequests.eventName,
      organiser: { name: organisers.name },
      from: { name: handoverSenders.name },
    })
    .from(eventHandovers)
    .innerJoin(eventRequests, eq(eventRequests.id, eventHandovers.eventRequestId))
    .innerJoin(organisers, eq(organisers.id, eventRequests.organiserId))
    .leftJoin(handoverSenders, eq(handoverSenders.id, eventHandovers.fromCoordinatorId))
    .where(
      and(
        isNull(eventHandovers.decision),
        eq(eventHandovers.toCoordinatorId, actor.id),
        eq(eventRequests.assignedCoordinatorId, eventHandovers.fromCoordinatorId),
        notInArray(eventRequests.status, ["approved", "rejected"])
      )
    )
    .orderBy(asc(eventHandovers.requestedAt), asc(eventHandovers.id));
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
        permittedFields: input.permittedFields,
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
