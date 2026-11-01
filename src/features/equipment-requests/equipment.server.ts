import { and, count, eq, isNotNull, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  equipmentReservations,
  equipmentTypes,
  eventRequests,
  user,
} from "#/db/schema";
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
  parseMapEquipmentLineInput,
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
 * Keep this module server-only. A client-reachable value import of `#/db/schema` would ship the
 * full database schema to the browser. `server-fns.ts` imports it dynamically inside `.handler()`.
 * Middleware checks the session and the action's `equipment_request` permission (`manage`,
 * `submit`, or `arrange`) before these handlers run.
 */

type Database = typeof Db;

/**
 * Check that the event is editable and assigned to the actor. Return its row or throw 403.
 * Mutating handlers call this inside a transaction. The `FOR UPDATE` lock prevents a concurrent
 * submit between this check and the caller's write.
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
  // Check status after the query. A missing event returns 403. A settled event returns a conflict,
  // as in venue requests.
  if (!isEquipmentEditableStatus(event.status)) {
    throw new ConflictError(
      "Equipment can only be edited on an approved event that is not yet confirmed."
    );
  }
  return event;
}

/** A submitted request is frozen, so no equipment line can change. */
function assertNotSubmitted(event: { equipmentSubmittedAt: Date | null }) {
  if (event.equipmentSubmittedAt !== null) {
    throw new ConflictError(
      "This equipment request has already been submitted to Technical Support."
    );
  }
}

/**
 * Check whether the line reserves capacity by looking for a reservation row.
 * Partial reservations keep the line `requested`, so status alone is not enough.
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
 * Lock the line with `FOR UPDATE` and scope it to the event. This prevents a reservation from
 * committing between the check and the caller's write. No row means the line belongs to another event.
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
 * PTR-38 AC1/AC4: Add or update an equipment line for the assigned Coordinator.
 * Quantity must be a positive whole number. The Zod schema checks it first; the database CHECK is
 * the backstop.
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

    // Add a line with no Technical Support assignment. Count rows and insert in one transaction,
    // so two requests cannot both claim the last slot.
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
 * PTR-38 AC4: Remove an equipment line. It must belong to this event, and the event must remain editable.
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

    // The reservation foreign key cascades. Without this check, deleting the line would silently
    // free reserved capacity. Submitted lines are frozen, so this should rarely occur.
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
 * Check Technical Support access to an event. Read every line, lock them when `lock` is true, and
 * read the event status and submission state. Throw 403 unless the actor can work on at least one
 * line; this prevents probes of events with no assigned line.
 *
 * Lock lines before the event. Arrangement, reserve, and release handlers can run on submitted
 * events, so they lock lines before the event. Save and remove lock the event first, but refuse
 * submitted events. Confirmation can run before submission and locks lines before the event, so
 * save/remove and confirmation can deadlock (40P01). When `lock` is true, lock the event after its
 * lines so its status cannot change during the check.
 *
 * `loadReservableLine` in `reservations.server.ts` uses the same order: lock the equipment line
 * with `FOR UPDATE`, then the event with `FOR KEY SHARE`. It serializes with these handlers.
 *
 * Return the status so arrangement handlers can apply PTR-43's confirmation gate. Reserve and
 * release remain available after confirmation.
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
 * PTR-43: Allow changes to arrangements only before event confirmation.
 * Keep reserve and release open after confirmation (PTR-24 AC6); the Coordinator handles them
 * manually. The three arrangement handlers call this after the event-level check.
 */
function assertArrangementsEditable(status: string | undefined) {
  if (status === undefined || !isEquipmentEditableStatus(status)) {
    throw new ConflictError(
      "Technical arrangements can only be changed before the event is confirmed."
    );
  }
}

/**
 * PTR-39 AC3: Technical Support can set a line's arrangement state, add notes, or do both.
 * Lock every line so a concurrent reservation cannot be overwritten. Use the work-list rule
 * (`isEquipmentQueueRow`): refuse members with no line on the event, and refuse a colleague's line.
 * This prevents event and line probes. Record the acting member on the line so the event stays in
 * their list after no line remains `requested`.
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
    // PTR-41 sets `reserved`; only PTR-42 can clear it. A line with a reservation row cannot change
    // state, and partial reservations remain `requested`. Notes can still change.
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
 * PTR-38 AC5: Submit the full equipment list to Technical Support.
 * Refuse when no lines are recorded. Commit the submission and notifications in one transaction;
 * the worker sends each member's email from the queue.
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

    // Resolve recipients and write notification rows in this transaction. The worker sends the
    // emails, so a mail outage cannot lose the submission notice.
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
 * Clear a recorded completion stamp. Do nothing when the event has no stamp.
 * Call this in the transaction that changes a line or reduces/releases a reservation, so the
 * confirmation gate never reads stale data.
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
 * Add a notification for the assigned Coordinator in the caller's transaction. Return whether a
 * row was queued. Log when no Coordinator is assigned; do not fail an outcome that is already
 * committed. The reservation release path also uses this function.
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
 * PTR-43 AC1: Mark all equipment arrangements for the event as complete.
 * Every line must be `reserved` or `not_required`. Refuse when any line has another state. Stamp
 * completion on the event row without changing event status. No equipment lines means the
 * confirmation gate is satisfied.
 */
export async function handleCompleteArrangements(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseCompleteArrangementsInput(data);
  const result = await database.transaction(async tx => {
    // Lock every line so a concurrent reservation cannot change it between the check and the stamp.
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

    // Commit completion and notification together. The worker sends the notification.
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
 * PTR-43 AC2: Record that Technical Support cannot provide a requested equipment line.
 * Set its arrangement state to `unavailable`, save the reason, and notify the assigned Coordinator.
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

    // Release a reserved line before marking it unavailable; it currently holds capacity.
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

    // The unavailability record clears any prior completion stamp.
    await clearArrangementsCompletion(tx, input.eventId);

    // Commit the outcome and notification together. The worker sends the notification.
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

/**
 * PTR-162 AC5: map a free-text line to a catalogue type so reserve can use it. Lock the lines
 * so a concurrent reservation cannot commit between the check and the write. Refuse a line
 * that already holds a reservation; release it first.
 */
export async function handleMapEquipmentLine(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseMapEquipmentLineInput(data);
  return database.transaction(async tx => {
    const { lines, submitted } = await loadWorkableLines(tx, input.eventId, actor, true);
    const line = lines.find(row => row.id === input.id);
    if (!line) throw new NotFoundError("Not Found");
    if (!isEquipmentQueueRow(line, actor.id, submitted)) throw new AuthorizationError("Forbidden");
    if (await lineHoldsReservation(tx, line.id)) {
      throw new ConflictError(ARRANGEMENT_RESERVED_MESSAGE);
    }
    const type = (
      await tx
        .select({ id: equipmentTypes.id })
        .from(equipmentTypes)
        .where(eq(equipmentTypes.id, input.equipmentTypeId))
        .limit(1)
    ).at(0);
    if (!type) throw new NotFoundError("Not Found");
    const [updated] = await tx
      .update(equipmentRequests)
      .set({ equipmentTypeId: type.id, assignedStaffId: actor.id })
      .where(eq(equipmentRequests.id, line.id))
      .returning();
    await clearArrangementsCompletion(tx, input.eventId);
    return updated;
  });
}
