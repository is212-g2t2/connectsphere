import { and, eq, isNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import { equipmentRequests, eventRequests, user } from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  EQUIPMENT_NO_LINES_MESSAGE,
  parseEquipmentLineInput,
  parseRemoveEquipmentLineInput,
  parseSubmitEquipmentInput,
} from "#/features/equipment-requests/schema";

/**
 * Server-only on purpose, and named for it: `#/db/schema` is a value import here, which would
 * ship the whole database schema to the browser from any module a route can reach.
 * `server-fns.ts` reaches this through a dynamic `import()` inside `.handler()`.
 *
 * The middleware pipeline has already verified the session and `equipment_request:manage` (or
 * `submit`) before these handlers run.
 */

type Database = typeof Db;

/**
 * The statuses a Coordinator may edit equipment on: approved (AC1) and planning (AC4 says "not
 * yet confirmed", which is the `planning` stage before `confirmed`).
 */
const EDITABLE_STATUSES = ["approved", "planning"] as const;

/**
 * Verifies the event is in an editable status and is assigned to the actor. Returns the event row
 * or throws 403. Every mutating handler calls this so the rule has exactly one home.
 */
async function loadEditableEvent(
  database: Pick<Database, "select">,
  eventId: number,
  coordinatorId: string
) {
  const rows = await database
    .select({ id: eventRequests.id, status: eventRequests.status })
    .from(eventRequests)
    .where(
      and(eq(eventRequests.id, eventId), eq(eventRequests.assignedCoordinatorId, coordinatorId))
    )
    .limit(1);
  const event = rows.at(0);
  if (!event) throw new AuthorizationError("Forbidden");
  // The status check is post-query so the coordinator gets 403 for a missing event and a
  // conflict message for a settled one, matching the pattern established by venue requests.
  if (!(EDITABLE_STATUSES as readonly string[]).includes(event.status)) {
    throw new ConflictError(
      "Equipment can only be edited on an approved event that is not yet confirmed."
    );
  }
  return event;
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
  await loadEditableEvent(database, input.eventId, actor.id);

  if (input.id) {
    // Edit path: the line must belong to this event, not someone else's.
    const rows = await database
      .update(equipmentRequests)
      .set({
        item: input.item,
        quantity: input.quantity,
        notes: input.notes ?? null,
      })
      .where(and(eq(equipmentRequests.id, input.id), eq(equipmentRequests.eventId, input.eventId)))
      .returning();
    if (rows.length === 0) throw new NotFoundError("Not Found");
    return rows[0];
  }

  // Add path: a new line with no Technical Support assignment yet.
  const [inserted] = await database
    .insert(equipmentRequests)
    .values({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      item: input.item,
      quantity: input.quantity,
      notes: input.notes ?? null,
    })
    .returning();
  return inserted;
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
  await loadEditableEvent(database, input.eventId, actor.id);

  const rows = await database
    .delete(equipmentRequests)
    .where(and(eq(equipmentRequests.id, input.id), eq(equipmentRequests.eventId, input.eventId)))
    .returning();
  if (rows.length === 0) throw new NotFoundError("Not Found");
  return rows[0];
}

/**
 * PTR-38 AC5: submit the full equipment list to Technical Support. Refuses when no lines are
 * recorded — there is nothing to submit. Returns the lines and the recipient emails; the server
 * function sends the notification after this resolves, matching the best-effort pattern venue
 * requests use (the send runs after the commit, so a mail outage cannot undo the submission).
 */
export async function handleSubmitEquipmentRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseSubmitEquipmentInput(data);
  return database.transaction(async tx => {
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
}
