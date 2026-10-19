import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseClarificationReply,
  parseDraftInput,
  parseEventChangeRequestInput,
  parseEventRequestId,
} from "#/features/event-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("event-requests");

export const requireEventRequestCreate = requirePermission({ event_request: ["create"] });
export const requireEventRequestCoordinate = requirePermission({
  event_request: ["coordinate"],
});
/** PTR-144: the Event Coordinator Lead's read — the queue and every event. */
export const requireEventRequestOversee = requirePermission({ event_request: ["oversee"] });
/** PTR-145: the Lead's assignment and reassignment verb. No other role holds it. */
export const requireEventRequestAssign = requirePermission({ event_request: ["assign"] });

/** A saved draft as the client sees it. Derive it here, so no route imports the server module. */
export type EventRequestDraft = Awaited<ReturnType<typeof saveEventRequestDraft>>;

/** One of the organiser's requests as the list and detail pages see it (PTR-14), Coordinator resolved (PTR-15). */
export type EventRequestSummary = Awaited<ReturnType<typeof listEventRequests>>[number];

/** One request as the detail page sees it, clarifications included. */
export type EventRequestDetail = NonNullable<
  Awaited<ReturnType<typeof getEventRequest>>["request"]
>;

/** A submitted request awaiting a Coordinator, as the Lead's queue sees it (PTR-144). */
export type UnassignedEventRequest = Awaited<
  ReturnType<typeof listUnassignedEventRequests>
>[number];

async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/event-requests/drafts.server")]);
}

/**
 * Routes import this module, so do not add static server imports here. Middleware must remain
 * client-safe. The handler imports `./drafts.server` and `#/db` dynamically; TanStack Start removes
 * the handler from the client build.
 */
export const saveEventRequestDraft = createServerFn({ method: "POST" })
  .validator(parseDraftInput)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSaveEventRequestDraft }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    return handleSaveEventRequestDraft(data, context.user, db);
  });

/**
 * PTR-13: Submit a saved draft by id so the page cannot send unsaved data.
 * Use `event_request:create`, the same permission as the save path. Storage-level status checks
 * limit submission to the Organiser's own draft.
 */
export const submitEventRequest = createServerFn({ method: "POST" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleSubmitEventRequest }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    const request = await handleSubmitEventRequest(data, context.user, db);

    log.info("Event request submitted", {
      requestId: request.id,
      organiserId: context.user.id,
      coordinatorId: request.assignedCoordinatorId,
    });

    return request;
  });

/**
 * PTR-14: List the signed-in Organiser's requests, including drafts, newest change first.
 * Use `event_request:create` as for `submitEventRequest`. Scope rows to `organiserId` until PTR-8
 * adds relationship-based access.
 */
export const listEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCreate])
  .handler(async ({ context }) => {
    const [{ db }, { handleListEventRequests }] = await loadServer();
    return handleListEventRequests(context.user, db);
  });

/**
 * PTR-14 criterion 4: Return one of the Organiser's requests as recorded.
 * Wrap the result in an object because a nullable top-level result infers as `never`, as `getVenue` documents.
 * Return `null` for another user's row or a missing row, so the id space reveals nothing.
 */
export const getEventRequest = createServerFn({ method: "GET" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetEventRequest }] = await loadServer();
    return { request: await handleGetEventRequest(data, context.user, db) };
  });

/**
 * PTR-144: return requests with no assigned Coordinator, oldest first, with the Organiser's
 * details. The unassigned queue is the Event Coordinator Lead's; a Coordinator is refused.
 * Submission no longer auto-assigns, so every fresh submission starts here.
 */
export const listUnassignedEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestOversee])
  .handler(async () => {
    const [{ db }, { handleListUnassignedEventRequests }] = await loadServer();
    return handleListUnassignedEventRequests(db);
  });

/**
 * Criterion 2: Load an owned draft to seed the edit form.
 * Wrap the result in an object because a nullable top-level result infers as `never`, as `getEventRequest` documents.
 * Return `null` for another user's row, a submitted request, or a missing row.
 */
export const getEventRequestDraft = createServerFn({ method: "GET" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetEventRequestDraft }] = await loadServer();

    return { draft: await handleGetEventRequestDraft(data, context.user, db) };
  });

/** Criterion 3: Delete an owned draft. The handler's scope rejects submitted requests. */
export const deleteEventRequestDraft = createServerFn({ method: "POST" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleDeleteEventRequestDraft }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/drafts.server"),
    ]);

    const deleted = await handleDeleteEventRequestDraft(data, context.user, db);

    log.info("Draft deleted", {
      requestId: deleted.id,
      organiserId: context.user.id,
    });

    return deleted;
  });

export type EventRequestDeleted = Awaited<ReturnType<typeof deleteEventRequestDraft>>;

export const replyToClarification = createServerFn({ method: "POST" })
  .middleware([requireEventRequestCreate])
  .validator(parseClarificationReply)
  .handler(async ({ data, context }) => {
    const [{ db }, { handleReplyToClarification }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/replies.server"),
    ]);
    const result = await handleReplyToClarification(data, context.user, db);

    log.info("Clarification replied", {
      requestId: data.id,
      clarificationId: data.clarificationId,
      organiserId: context.user.id,
    });

    return result;
  });

/** PTR-51: records an Organiser's change request and notifies the assigned Coordinator. */
export const raiseEventChangeRequest = createServerFn({ method: "POST" })
  .validator(parseEventChangeRequestInput)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRaiseEventChangeRequest }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/change-requests.server"),
    ]);
    const result = await handleRaiseEventChangeRequest(data, context.user, db);

    log.info("Event change request raised", {
      requestId: data.id,
      changeRequestId: result.id,
      organiserId: context.user.id,
    });

    return result;
  });

/**
 * PTR-53: Record the Organiser's cancellation request and notify the assigned Coordinator.
 * Keep the event status until the Coordinator decides (PTR-54).
 */
export const requestEventCancellation = createServerFn({ method: "POST" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRequestEventCancellation }] = await Promise.all([
      import("#/db"),
      import("#/features/event-requests/cancellation-requests.server"),
    ]);
    const result = await handleRequestEventCancellation(data, context.user, db);

    log.info("Event cancellation requested", {
      requestId: data.id,
      cancellationRequestId: result.id,
      organiserId: context.user.id,
    });

    return result;
  });
