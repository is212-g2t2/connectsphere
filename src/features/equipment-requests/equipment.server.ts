import { and, count, eq, isNotNull, isNull } from "drizzle-orm";

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
import { isArrangedLine, isEquipmentQueueRow } from "#/features/events/access";
import { raiseNotifications } from "#/features/notifications/raise.server";
import type { NewNotification } from "#/features/notifications/raise.server";
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
      eventName: eventRequests.eventName,
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
 * The event-level gate for Technical Support: every line of the event (locked when `lock`), the
 * event's status and whether it is submitted. Throws 403 unless the actor may work at least one
 * line, so a probe of an event they have no line on says nothing about it.
 *
 * Lock order is lines -> event: every writer that can run on a submitted event (these arrangement
 * handlers, reserve, release) takes its line locks before touching the event row (the reservation
 * paths do so through the completion clear), so they cannot form a cycle. save/remove take the
 * event first but refuse once the request is submitted; confirmation also takes lines then event
 * and can be attempted before submission, so that pair can deadlock (40P01). When `lock`, the
 * event row is locked after the lines, so the status the caller's gate reads cannot change under it.
 *
 * The reserve path (`loadReservableLine` in `reservations.server.ts`) follows the same
 * lines-then-event order — equipment line `FOR UPDATE`, then the event `FOR KEY SHARE` — so
 * it serialises with these handlers rather than against them; the 40P01 pair above stands.
 *
 * The status is returned so the arrangement handlers can apply PTR-43's confirmation gate;
 * reserve and release deliberately stay open after confirmation.
 */
export async function loadWorkableLines(
  database: Pick<Database, "select">,
  eventId: number,
  actor: SessionUser,
  lock = false
) {
  const lineQuery = database
    .select()
    .from(equipmentRequests)
    .where(eq(equipmentRequests.eventId, eventId));
  const lines = await (lock ? lineQuery.for("update") : lineQuery);
  const eventQuery = database
    .select({
      status: eventRequests.status,
      submittedAt: eventRequests.equipmentSubmittedAt,
    })
    .from(eventRequests)
    .where(eq(eventRequests.id, eventId))
    .limit(1);
  const event = (await (lock ? eventQuery.for("update") : eventQuery)).at(0);
  const submitted = Boolean(event?.submittedAt);
  if (!lines.some(row => isEquipmentQueueRow(row, actor.id, submitted))) {
    throw new AuthorizationError("Forbidden");
  }
  return { lines, submitted, status: event?.status };
}

/**
 * PTR-43: arrangements are mutable only before the event is confirmed. Reserve and release stay
 * open after confirmation (PTR-24 AC6 expects the Coordinator to handle those manually); the
 * three arrangement handlers call this after the event-level gate.
 */
function assertArrangementsEditable(status: string | undefined) {
  if (status === undefined || !isEquipmentEditableStatus(status)) {
    throw new ConflictError(
      "Technical arrangements can only be changed before the event is confirmed."
    );
  }
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
    const { lines, submitted, status } = await loadWorkableLines(tx, input.eventId, actor, true);
    assertArrangementsEditable(status);
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

    // A status or notes change may invalidate a prior completion stamp.
    if (input.arrangementStatus !== undefined || input.arrangementNotes !== undefined) {
      await clearArrangementsCompletion(tx, input.eventId);
    }

    return updated;
  });
}

/**
 * PTR-38 AC5: submit the full equipment list to Technical Support. Refuses when no lines are
 * recorded — there is nothing to submit. The submission and its notifications commit in the same
 * transaction, so the worker delivers every Technical Support member's email from the queue.
 */
export async function handleSubmitEquipmentRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseSubmitEquipmentInput(data);
  const submitted = await database.transaction(async tx => {
    const event = await loadEditableEvent(tx, input.eventId, actor.id);

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
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, "technical_support_staff"));

    // Recipients are resolved and the rows written in the transaction; the worker sends the
    // emails from the queue, so a mail outage cannot lose the submission notice.
    await raiseNotifications(
      tx,
      recipients.map(recipient => ({
        recipientId: recipient.id,
        eventRequestId: input.eventId,
        kind: "equipment_requested" as const,
        payload: {
          eventName: event.eventName.trim() || "Untitled event",
          lines: lines.map(line => ({
            id: line.id,
            item: line.item,
            quantity: line.quantity,
            notes: line.notes,
          })),
        },
      }))
    );

    return { lines, recipientCount: recipients.length };
  });

  if (submitted.recipientCount === 0) {
    log.warn("No Technical Support Staff to notify of equipment request", {
      eventId: input.eventId,
    });
  }

  return { lineCount: submitted.lines.length, recipientCount: submitted.recipientCount };
}

// ── PTR-43: Technical arrangement completion / unavailability ──────────────────────────────────

/**
 * Clears a previously recorded completion stamp. Scoped to rows that have a stamp, so it is a
 * no-op when nothing was recorded. Called inside the same transaction that mutates
 * a line (add, edit, remove) or reduces/releases a reservation, so the confirmation gate never
 * reads a stale completion.
 */
export async function clearArrangementsCompletion(tx: Pick<Database, "update">, eventId: number) {
  await tx
    .update(eventRequests)
    .set({
      equipmentArrangementsCompletedAt: null,
      equipmentArrangementsCompletedById: null,
    })
    .where(
      and(eq(eventRequests.id, eventId), isNotNull(eventRequests.equipmentArrangementsCompletedAt))
    );
}

/**
 * Raises the assigned Coordinator's notification for a Technical Support outcome inside the
 * caller's transaction, returning whether a row was queued. Logs when no Coordinator is assigned,
 * rather than failing an outcome that is already committed. Shared with the reservation release
 * path, which has the same recipient shape.
 */
export async function raiseCoordinatorNotification(
  tx: Pick<Database, "insert" | "select">,
  eventId: number,
  build: (context: { coordinatorId: string; eventName: string }) => NewNotification
): Promise<boolean> {
  const event = (
    await tx
      .select({
        eventName: eventRequests.eventName,
        coordinatorId: eventRequests.assignedCoordinatorId,
      })
      .from(eventRequests)
      .where(eq(eventRequests.id, eventId))
      .limit(1)
  ).at(0);

  if (!event?.coordinatorId) {
    log.warn("No assigned Coordinator to notify", { eventId });
    return false;
  }

  await raiseNotifications(tx, [
    build({
      coordinatorId: event.coordinatorId,
      eventName: event.eventName.trim() || "Untitled event",
    }),
  ]);
  return true;
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
    const { lines, status } = await loadWorkableLines(tx, input.eventId, actor, true);
    assertArrangementsEditable(status);

    const unarranged = lines.filter(line => !isArrangedLine(line.arrangementStatus));
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

    // The completion and the Coordinator's notification commit together; the worker sends it.
    await raiseCoordinatorNotification(tx, input.eventId, context => ({
      recipientId: context.coordinatorId,
      eventRequestId: input.eventId,
      kind: "equipment_arrangements_completed",
      payload: { eventName: context.eventName, lineCount: lines.length },
    }));

    return updated;
  });

  return result;
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
    const { lines, submitted, status } = await loadWorkableLines(tx, input.eventId, actor, true);
    assertArrangementsEditable(status);
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

    // The outcome and the Coordinator's notification commit together; the worker sends it.
    await raiseCoordinatorNotification(tx, input.eventId, context => ({
      recipientId: context.coordinatorId,
      eventRequestId: input.eventId,
      kind: "equipment_unavailable",
      payload: {
        eventName: context.eventName,
        item: updatedLine.item,
        quantity: updatedLine.quantity,
        reason: input.reason,
      },
    }));

    return updatedLine;
  });

  return updated;
}
