import { and, eq } from "drizzle-orm";
import { createElement } from "react";
import type { db as Db } from "#/db";
import { clarificationRequests, eventRequests, user } from "#/db/schema";
import { env } from "#/env";
import { ClarificationReplyEmail } from "#/features/emails/components/clarification-reply-email";
import { sendEmail } from "#/lib/mailer.server";
import { logger } from "#/lib/logger";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  clarificationAmendmentKeys,
  missingFieldsMessage,
  missingRequiredFields,
  parseClarificationReply,
  parseDraftInput,
} from "#/features/event-requests/schema";
import type {
  ClarificationAmendment,
  ClarificationAmendmentValue,
  ClarificationField,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";

/**
 * JSON with object keys in a fixed order. `jsonb` reorders keys when it stores them, so a plain
 * `JSON.stringify` of the locked row and of the freshly parsed values can differ on key order
 * alone; sorting here compares the values, not how Postgres laid them out. An explicit `undefined`
 * becomes `null`, matching how an absent value returns from the row; a missing key stays missing.
 */
function normalisedForComparison(value: unknown): ClarificationAmendmentValue {
  if (Array.isArray(value)) return value.map(normalisedForComparison);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]): [string, ClarificationAmendmentValue] => [
          key,
          normalisedForComparison(entry),
        ])
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalisedForComparison(left)) === JSON.stringify(normalisedForComparison(right))
  );
}

/**
 * PTR-19: what a reply actually changed, measured against the locked row. A field the question
 * permits but the reply leaves identical produces no entry, so a client that re-sends every
 * permitted value cannot pad the history. `attendeeRegistration` is one entry covering its four
 * columns.
 */
function clarificationAmendments(
  request: typeof eventRequests.$inferSelect,
  values: EventRequestDraftValues,
  permittedFields: readonly ClarificationField[]
): ClarificationAmendment[] {
  const amendments: ClarificationAmendment[] = [];
  const seen = new Set<ClarificationField>();

  for (const field of permittedFields) {
    if (seen.has(field)) continue;
    seen.add(field);

    if (field === "attendeeRegistration") {
      const from = {
        registrationEnabled: request.registrationEnabled,
        registrationCapacity: request.registrationCapacity,
        registrationOpensAt: request.registrationOpensAt,
        registrationClosesAt: request.registrationClosesAt,
      };
      const to = {
        registrationEnabled: values.registrationEnabled,
        registrationCapacity: values.registrationCapacity,
        registrationOpensAt: values.registrationOpensAt,
        registrationClosesAt: values.registrationClosesAt,
      };
      if (!sameValue(from, to)) {
        amendments.push({
          field,
          from: normalisedForComparison(from),
          to: normalisedForComparison(to),
        });
      }
      continue;
    }
    // A permitted field this build no longer knows about maps to no column, so it cannot differ.
    if (!clarificationAmendmentKeys(field).includes(field)) continue;
    const from = request[field];
    const to = values[field];
    if (!sameValue(from, to)) {
      amendments.push({
        field,
        from: normalisedForComparison(from),
        to: normalisedForComparison(to),
      });
    }
  }

  return amendments;
}

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
    const amendments = clarificationAmendments(request, values, question.permittedFields);
    const coordinator = (
      await tx
        .select({ email: user.email })
        .from(user)
        .where(and(eq(user.id, request.assignedCoordinatorId), eq(user.role, "event_coordinator")))
    ).at(0);
    if (!coordinator)
      throw new ConflictError(
        "The assigned Coordinator is unavailable. Try again after reassignment."
      );
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
    return { clarification, coordinatorEmail: coordinator.email, eventName: values.eventName };
  });
  const displayName = recorded.eventName.trim() || "Untitled request";
  try {
    await sendEmail(
      recorded.coordinatorEmail,
      `Clarification replied: ${displayName}`,
      createElement(ClarificationReplyEmail, {
        eventName: displayName,
        question: recorded.clarification.body,
        body: input.body,
        eventRequestUrl: `${env.BETTER_AUTH_URL}/coordination/${input.id}`,
      })
    );
  } catch (error) {
    logger.getChild("event-requests").warn("Clarification reply email failed", {
      requestId: input.id,
      clarificationId: input.clarificationId,
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { clarification: recorded.clarification, notification: "failed" as const };
  }
  return { clarification: recorded.clarification, notification: "sent" as const };
}
