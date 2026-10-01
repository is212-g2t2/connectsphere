import { and, count, eq, isNull } from "drizzle-orm";
import { createElement } from "react";

import type { db as Db } from "#/db";
import { equipmentRequests, equipmentReservations, eventRequests, user } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  ARRANGEMENT_RESERVED_MESSAGE,
  EQUIPMENT_NO_LINES_MESSAGE,
  EQUIPMENT_RESERVED_EDIT_MESSAGE,
  EQUIPMENT_RESERVED_REMOVE_MESSAGE,
  isEquipmentEditableStatus,
  parseArrangementUpdateInput,
  parseCompleteArrangementsInput,
  parseEquipmentLineInput,
  parseRecordUnavailableInput,
  parseRemoveEquipmentLineInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";
import { EQUIPMENT_MAX_LINES } from "#/features/event-requests/schema";
import { isEquipmentQueueRow } from "#/features/events/access";
import { logger } from "#/lib/logger";

const log = logger.getChild("equipment-requests");

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach.
 * `server-fns.ts` reaches this through a dynamic `import()` inside `.handler()`.
 *
 * The middleware pipeline has already verified the session and the `equipment_request` permission
 * for the action (`manage`, `submit` or `arrange`) before these handlers run.
 */

type Database = typeof Db;

/**
 * Verifies the event is in an editable status and is assigned to the actor. Returns the event row
 * or throws 403. Every mutating handler calls this so the rule has exactly one home, and every one
 * calls it inside a transaction: the `FOR UPDATE` lock stops a concurrent submit committing
 * between this check and the caller's write.
 */
async function loadEditableEvent(
  database: Pick<Database, "select">,
  eventId: number,
  coordinatorId: string
) {
  const rows = await database
    .select({
      id: eventRequests.id,
      status: eventRequests.status,
      equipmentSubmittedAt: eventRequests.equipmentSubmittedAt,
    })
    .from(eventRequests)
    .where(
      and(eq(eventRequests.id, eventId), eq(eventRequests.assignedCoordinatorId, coordinatorId))
    )
    .limit(1)
    .for("update");
  const event = rows.at(0);
  if (!event) throw new AuthorizationError("Forbidden");
  // The status check is post-query so the coordinator gets 403 for a missing event and a
  // conflict message for a settled one, matching the pattern established by venue requests.
  if (!isEquipmentEditableStatus(event.status)) {
    throw new ConflictError(
      "Equipment can only be edited on an approved event that is not yet confirmed."
    );
  }
  return event;
}

/** A submitted request is frozen: the submit handler's own one-shot guard aside, no line may change. */
function assertNotSubmitted(event: { equipmentSubmittedAt: Date | null }) {
  if (event.equipmentSubmittedAt !== null) {
    throw new ConflictError(
      "This equipment request has already been submitted to Technical Support."
    );
  }
}

/**
 * Whether the line commits capacity: a reservation row exists for it. A partial reservation keeps
 * the line `requested`, so callers cannot rely on the status alone — every state/line guard below
 * probes the row instead.
 */
async function lineHoldsReservation(
  database: Pick<Database, "select">,
  lineId: string
): Promise<boolean> {
  const reservation = (
    await database
      .select({ id: equipmentReservations.id })
      .from(equipmentReservations)
      .where(eq(equipmentReservations.equipmentRequestId, lineId))
      .limit(1)
  ).at(0);
  return Boolean(reservation);
}

/**
 * The line row `FOR UPDATE` scoped to the event, so a reservation cannot commit between the probe
 * below and the caller's write. No row means the line is not this event's.
 */
async function lockEventLine(database: Pick<Database, "select">, lineId: string, eventId: number) {
  const rows = await database
    .select({ id: equipmentRequests.id })
    .from(equipmentRequests)
    .where(and(eq(equipmentRequests.id, lineId), eq(equipmentRequests.eventId, eventId)))
    .limit(1)
    .for("update");
  if (rows.length === 0) throw new NotFoundError("Not Found");
}

/**
 * PTR-38 AC1/AC4: add a new equipment line or update an existing one on behalf of the assigned
 * Coordinator. Quantity must be a positive whole number (enforced by the Zod schema before this
 * runs, and by the DB CHECK as backstop).
 */
export async function handleSaveEquipmentLine(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseEquipmentLineInput(data);
  return database.transaction(async tx => {
    const event = await loadEditableEvent(tx, input.eventId, actor.id);
    assertNotSubmitted(event);

    if (input.id) {
      // Edit path: the line must belong to this event, not someone else's.
      await lockEventLine(tx, input.id, input.eventId);
      if (await lineHoldsReservation(tx, input.id)) {
        throw new ConflictError(EQUIPMENT_RESERVED_EDIT_MESSAGE);
      }
      const rows = await tx
        .update(equipmentRequests)
        .set({
          item: input.item,
          quantity: input.quantity,
          notes: input.notes ? input.notes : null,
        })
        .where(
          and(eq(equipmentRequests.id, input.id), eq(equipmentRequests.eventId, input.eventId))
        )
        .returning();
      if (rows.length === 0) throw new NotFoundError("Not Found");
      await clearArrangementsCompletion(tx, input.eventId);
      return rows[0];
    }

    // Add path: a new line with no Technical Support assignment yet. The cap is a row count inside
    // the same transaction as the insert, so two adds racing for the last slot cannot both pass.
    const [{ value: lineCount }] = await tx
      .select({ value: count() })
      .from(equipmentRequests)
      .where(eq(equipmentRequests.eventId, input.eventId));
    if (lineCount >= EQUIPMENT_MAX_LINES) {
      throw new ConflictError(
        `This event already has the maximum of ${EQUIPMENT_MAX_LINES} equipment lines.`
      );
    }

    const [inserted] = await tx
      .insert(equipmentRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: input.eventId,
        item: input.item,
        quantity: input.quantity,
        notes: input.notes ? input.notes : null,
      })
      .returning();
    await clearArrangementsCompletion(tx, input.eventId);
    return inserted;
  });
}

/**
 * PTR-38 AC4: remove one equipment line. The line must belong to this event, and the event must
 * still be in an editable status.
 */
export async function handleRemoveEquipmentLine(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseRemoveEquipmentLineInput(data);
  return database.transaction(async tx => {
    const event = await loadEditableEvent(tx, input.eventId, actor.id);
    assertNotSubmitted(event);

    // The reservation FK cascades, so without this a delete would silently vanish committed
    // capacity. Post-submit lines are frozen, which is why this is nearly unreachable.
    await lockEventLine(tx, input.id, input.eventId);
    if (await lineHoldsReservation(tx, input.id)) {
      throw new ConflictError(EQUIPMENT_RESERVED_REMOVE_MESSAGE);
    }

    const rows = await tx
      .delete(equipmentRequests)
      .where(and(eq(equipmentRequests.id, input.id), eq(equipmentRequests.eventId, input.eventId)))
      .returning();
    if (rows.length === 0) throw new NotFoundError("Not Found");
    await clearArrangementsCompletion(tx, input.eventId);
    return rows[0];
  });
}

/**
 * The event-level gate for Technical Support: every line of the event (locked when `lock`), and
 * whether the event is submitted. Throws 403 unless the actor may work at least one line, so a
 * probe of an event they have no line on says nothing about it.
 */
export async function loadWorkableLines(
  database: Pick<Database, "select">,
  eventId: number,
  actor: SessionUser,
  lock = false
) {
  const query = database
    .select()
    .from(equipmentRequests)
    .where(eq(equipmentRequests.eventId, eventId));
  const lines = await (lock ? query.for("update") : query);
  const events = await database
    .select({ submittedAt: eventRequests.equipmentSubmittedAt })
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId))
    .limit(1);
  const submitted = Boolean(events.at(0)?.submittedAt);
  if (!lines.some(row => isEquipmentQueueRow(row, actor.id, submitted))) {
    throw new AuthorizationError("Forbidden");
  }
  return { lines, submitted };
}

/**
 * PTR-39 AC3: Technical Support sets a line's arrangement state, adds notes, or both.
 *
 * Every line of the event is read under a row lock, so a reservation committing at the same
 * moment is seen rather than overwritten. Who may touch what is the queue rule the work list uses
 * (`isEquipmentQueueRow`): a member with no line on the event is refused outright, so probing line
 * ids says nothing about the event, and a colleague's line is refused even when the event is
 * theirs to work. The update records the acting member on the line, which keeps the event on their
 * list once no line is left in `requested`.
 */
export async function handleUpdateArrangement(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseArrangementUpdateInput(data);
  return database.transaction(async tx => {
    const { lines, submitted } = await loadWorkableLines(tx, input.eventId, actor, true);
    const line = lines.find(row => row.id === input.id);
    if (!line) throw new NotFoundError("Not Found");
    if (!isEquipmentQueueRow(line, actor.id, submitted)) throw new AuthorizationError("Forbidden");
    // The reservation action (PTR-41) owns `reserved`, and its release (PTR-42) is the only way
    // out. A line holding a reservation row is frozen as well: partial reservations stay
    // `requested`. Notes are not a state change, so they still go through.
    if (input.arrangementStatus !== undefined && line.arrangementStatus === "reserved") {
      throw new ConflictError(ARRANGEMENT_RESERVED_MESSAGE);
    }
    if (input.arrangementStatus !== undefined && (await lineHoldsReservation(tx, line.id))) {
      throw new ConflictError(ARRANGEMENT_RESERVED_MESSAGE);
    }

    const changes: Partial<typeof equipmentRequests.$inferInsert> = { assignedStaffId: actor.id };
    if (input.arrangementStatus !== undefined) {
      changes.arrangementStatus = input.arrangementStatus;
      changes.unavailableReason =
        input.arrangementStatus === "unavailable" ? (input.unavailableReason ?? null) : null;
    }
    if (input.arrangementNotes !== undefined) {
      changes.arrangementNotes = input.arrangementNotes === "" ? null : input.arrangementNotes;
    }

    const [updated] = await tx
      .update(equipmentRequests)
      .set(changes)
      .where(eq(equipmentRequests.id, line.id))
      .returning();

    // A status change may invalidate a prior completion stamp.
    if (input.arrangementStatus !== undefined) {
      await clearArrangementsCompletion(tx, input.eventId);
    }

    return updated;
  });
}

/**
 * PTR-38 AC5: submit the full equipment list to Technical Support. Refuses when no lines are
 * recorded — there is nothing to submit. The notification sends after the commit, matching the
 * best-effort pattern venue requests use (the send runs after the commit, so a mail outage
 * cannot undo the submission).
 */
export async function handleSubmitEquipmentRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseSubmitEquipmentInput(data);
  const submitted = await database.transaction(async tx => {
    await loadEditableEvent(tx, input.eventId, actor.id);

    const lines = await tx
      .select()
      .from(equipmentRequests)
      .where(eq(equipmentRequests.eventId, input.eventId));
    if (lines.length === 0) throw new ConflictError(EQUIPMENT_NO_LINES_MESSAGE);

    // Only the first submission wins; a second call matches no row.
    const marked = await tx
      .update(eventRequests)
      .set({ equipmentSubmittedAt: new Date() })
      .where(and(eq(eventRequests.id, input.eventId), isNull(eventRequests.equipmentSubmittedAt)))
      .returning({ id: eventRequests.id });
    if (marked.length === 0) {
      throw new ConflictError("This equipment request has already been submitted.");
    }

    const recipients = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.role, "technical_support_staff"));

    return { lines, recipientEmails: recipients.map(r => r.email) };
  });

  if (submitted.recipientEmails.length === 0) {
    log.warn("No Technical Support Staff to notify of equipment request", {
      eventId: input.eventId,
    });
    return {
      lineCount: submitted.lines.length,
      recipientCount: 0,
      failedCount: 0,
    };
  }

  // Reached only when there is someone to email, so save/remove never pay the mailer import.
  const [{ sendEmail }, { EquipmentRequestEmail }] = await Promise.all([
    import("#/lib/mailer.server"),
    import("#/features/emails/components/equipment-request-email"),
  ]);
  const results = await Promise.allSettled(
    submitted.recipientEmails.map(recipient =>
      sendEmail(
        recipient,
        `Equipment request for event ${input.eventId}`,
        createElement(EquipmentRequestEmail, { lines: submitted.lines, eventId: input.eventId })
      )
    )
  );
  const failed = results.filter(r => r.status === "rejected").length;
  if (failed > 0) {
    log.warn("Equipment request notification failed", {
      failed,
      total: submitted.recipientEmails.length,
      eventId: input.eventId,
    });
  }

  return {
    lineCount: submitted.lines.length,
    recipientCount: submitted.recipientEmails.length,
    failedCount: failed,
  };
}

// ── PTR-43: Technical arrangement completion / unavailability ──────────────────────────────────

/** The line states that count as "arranged" for the completion gate. */
const ARRANGED_STATES = new Set(["reserved", "not_required"]);

/**
 * Clears a previously recorded completion stamp. Called inside the same transaction that mutates
 * a line (add, edit, remove) or reduces/releases a reservation, so the confirmation gate never
 * reads a stale completion. A no-op when nothing was recorded.
 */
export async function clearArrangementsCompletion(tx: Pick<Database, "update">, eventId: number) {
  await tx
    .update(eventRequests)
    .set({
      equipmentArrangementsCompletedAt: null,
      equipmentArrangementsCompletedById: null,
    })
    .where(eq(eventRequests.id, eventId));
}

/**
 * Sends a best-effort email to the event's assigned Coordinator after a Technical Support outcome
 * (completion or unavailability). Returns the coordinator email for logging; null when no
 * coordinator is assigned.
 */
async function notifyCoordinator(
  eventId: number,
  subject: string,
  emailElement: React.ReactElement,
  database: Pick<Database, "select">
) {
  const event = (
    await database
      .select({
        coordinatorId: eventRequests.assignedCoordinatorId,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1)
  ).at(0);

  if (!event?.coordinatorId) {
    log.warn("No assigned Coordinator to notify", { eventId });
    return null;
  }

  const coordinator = (
    await database
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, event.coordinatorId))
      .limit(1)
  ).at(0);

  if (!coordinator) {
    log.warn("Assigned Coordinator account not found", {
      eventId,
      coordinatorId: event.coordinatorId,
    });
    return null;
  }

  const { sendEmail } = await import("#/lib/mailer.server");
  try {
    await sendEmail(coordinator.email, subject, emailElement);
  } catch (error) {
    log.warn("Coordinator notification failed", { eventId, error });
  }
  return coordinator.email;
}

/**
 * PTR-43 AC1: Technical Support Staff marks all equipment arrangements for the event as complete.
 *
 * Every line must be in state `reserved` or `not_required`; if any line is in another state the
 * action is refused. The completion is stamped on the event row; the event's status is unchanged.
 * An event with no equipment lines needs no completion action (the confirmation gate treats the
 * equipment side as satisfied).
 */
export async function handleCompleteArrangements(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseCompleteArrangementsInput(data);
  const result = await database.transaction(async tx => {
    // Lock all lines so a concurrent reservation change cannot slip between the check and the stamp.
    const { lines } = await loadWorkableLines(tx, input.eventId, actor, true);

    if (lines.length === 0) {
      throw new ConflictError(
        "This event has no equipment lines. No completion action is required."
      );
    }

    const unarranged = lines.filter(line => !ARRANGED_STATES.has(line.arrangementStatus));
    if (unarranged.length > 0) {
      const items = unarranged.map(l => l.item).join(", ");
      throw new ConflictError(
        `Cannot mark arrangements complete: the following lines are not yet reserved or marked not required: ${items}`
      );
    }

    const now = new Date();
    const [updated] = await tx
      .update(eventRequests)
      .set({
        equipmentArrangementsCompletedAt: now,
        equipmentArrangementsCompletedById: actor.id,
      })
      .where(eq(eventRequests.id, input.eventId))
      .returning({
        id: eventRequests.id,
        equipmentArrangementsCompletedAt: eventRequests.equipmentArrangementsCompletedAt,
      });

    return { event: updated, lineCount: lines.length };
  });

  // Best-effort notification after the transaction commits.
  const { EquipmentArrangementsCompleteEmail } =
    await import("#/features/emails/components/equipment-arrangements-email");
  await notifyCoordinator(
    input.eventId,
    `Equipment arrangements complete for event ${input.eventId}`,
    createElement(EquipmentArrangementsCompleteEmail, {
      eventId: input.eventId,
      lineCount: result.lineCount,
    }),
    database
  );

  return result.event;
}

/**
 * PTR-43 AC2: Technical Support Staff records that a requested equipment line cannot be provided.
 *
 * Sets the line's arrangement status to `unavailable` and stores the reason. The assigned
 * Coordinator is notified so they can adjust the event plan.
 */
export async function handleRecordUnavailable(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseRecordUnavailableInput(data);
  const updated = await database.transaction(async tx => {
    const { lines, submitted } = await loadWorkableLines(tx, input.eventId, actor, true);
    const line = lines.find(row => row.id === input.id);
    if (!line) throw new NotFoundError("Not Found");
    if (!isEquipmentQueueRow(line, actor.id, submitted)) {
      throw new AuthorizationError("Forbidden");
    }

    // A reserved line commits capacity; it cannot be marked unavailable without releasing first.
    if (line.arrangementStatus === "reserved" || (await lineHoldsReservation(tx, line.id))) {
      throw new ConflictError(ARRANGEMENT_RESERVED_MESSAGE);
    }

    const [updatedLine] = await tx
      .update(equipmentRequests)
      .set({
        arrangementStatus: "unavailable",
        unavailableReason: input.reason,
        assignedStaffId: actor.id,
        ...(input.arrangementNotes !== undefined
          ? { arrangementNotes: input.arrangementNotes === "" ? null : input.arrangementNotes }
          : {}),
      })
      .where(eq(equipmentRequests.id, line.id))
      .returning();

    // Recording unavailability invalidates any prior completion stamp.
    await clearArrangementsCompletion(tx, input.eventId);

    return updatedLine;
  });

  // Best-effort notification after the transaction commits.
  const { EquipmentUnavailableEmail } =
    await import("#/features/emails/components/equipment-arrangements-email");
  await notifyCoordinator(
    input.eventId,
    `Equipment unavailable for event ${input.eventId}`,
    createElement(EquipmentUnavailableEmail, {
      eventId: input.eventId,
      item: updated.item,
      quantity: updated.quantity,
      reason: input.reason,
    }),
    database
  );

  return updated;
}
