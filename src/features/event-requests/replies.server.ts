import { and, eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { clarificationRequests, eventRequests, user } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { raiseNotifications } from "#/features/notifications/raise.server";
import { amendmentsBetween } from "#/features/event-requests/amendments";
import {
  clarificationAmendmentKeys,
  missingFieldsMessage,
  missingRequiredFields,
  parseClarificationReply,
  parseDraftInput,
} from "#/features/event-requests/schema";

export async function handleReplyToClarification(
  data: unknown,
  actor: SessionUser,
  database: typeof Db
) {
  const input = parseClarificationReply(data);
  const recorded = await database.transaction(async tx => {
    // Assignment, review decisions and replies all lock the event first.
    const request = (
      await tx
        .select()
        .from(eventRequests)
        .where(and(eq(eventRequests.id, input.id), eq(eventRequests.organiserId, actor.id)))
        .for("update")
    ).at(0);
    if (!request) throw new AuthorizationError("Forbidden");
    const question = (
      await tx
        .select()
        .from(clarificationRequests)
        .where(
          and(
            eq(clarificationRequests.id, input.clarificationId),
            eq(clarificationRequests.eventRequestId, input.id)
          )
        )
    ).at(0);
    if (!question) throw new AuthorizationError("Forbidden");
    if (
      question.replyBody !== null ||
      !["awaiting_organiser", "under_review"].includes(request.status)
    ) {
      throw new ConflictError(
        "This clarification can no longer be replied to. Refresh the request."
      );
    }
    if (!request.assignedCoordinatorId) {
      throw new ConflictError(
        "This event needs an assigned Coordinator before you can reply. Keep your response and try again after assignment."
      );
    }
    const allowedKeys = new Set(
      question.permittedFields.flatMap(field => clarificationAmendmentKeys(field))
    );
    if (Object.keys(input.amendments).some(key => !allowedKeys.has(key))) {
      throw new AuthorizationError(
        "Only the fields selected for this clarification can be amended."
      );
    }
    const merged = { ...request, ...input.amendments };
    const { id: _id, ...values } = parseDraftInput({
      ...merged,
      expectedAttendance: merged.expectedAttendance ?? undefined,
      registrationCapacity: merged.registrationCapacity ?? undefined,
      registrationOpensAt: merged.registrationOpensAt ?? undefined,
      registrationClosesAt: merged.registrationClosesAt ?? undefined,
    });
    const missing = missingRequiredFields(values);
    if (missing.length) throw new Error(missingFieldsMessage(missing));
    const amendments = amendmentsBetween(request, values, question.permittedFields);
    const coordinator = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, request.assignedCoordinatorId), eq(user.role, "event_coordinator")))
    ).at(0);
    if (!coordinator) throw new ConflictError("This request's Coordinator is unavailable.");
    const [clarification] = await tx
      .update(clarificationRequests)
      .set({
        replyBody: input.body,
        repliedAt: new Date(),
        repliedByOrganiserId: actor.id,
        amendments,
      })
      .where(eq(clarificationRequests.id, question.id))
      .returning();
    await tx
      .update(eventRequests)
      .set({
        ...values,
        status: "under_review",
        expectedAttendance: values.expectedAttendance ?? null,
        registrationCapacity: values.registrationCapacity ?? null,
        registrationOpensAt: values.registrationOpensAt ?? null,
        registrationClosesAt: values.registrationClosesAt ?? null,
      })
      .where(eq(eventRequests.id, request.id));

    // The reply and the Coordinator's notification commit together; the worker sends the email.
    await raiseNotifications(tx, [
      {
        recipientId: coordinator.id,
        eventRequestId: request.id,
        kind: "clarification_replied",
        payload: {
          eventName: values.eventName.trim() || "Untitled request",
          question: question.body,
          body: input.body,
        },
      },
    ]);

    return clarification;
  });

  return recorded;
}
