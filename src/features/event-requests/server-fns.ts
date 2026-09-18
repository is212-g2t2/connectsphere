import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseDraftInput, parseEventRequestId } from "#/features/event-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("event-requests");

export const requireEventRequestCreate = requirePermission({ event_request: ["create"] });
export const requireEventRequestCoordinate = requirePermission({
  event_request: ["coordinate"],
});

/** A saved draft as the client sees it — derived here so no route has to import the server module. */
export type EventRequestDraft = Awaited<ReturnType<typeof saveEventRequestDraft>>;

/** One of the organiser's requests as the list and detail pages see it (PTR-14), Coordinator resolved (PTR-15). */
export type EventRequestSummary = Awaited<ReturnType<typeof listEventRequests>>[number];

/** A submitted request awaiting a Coordinator, as the coordination page sees it (PTR-15). */
export type UnassignedEventRequest = Awaited<
  ReturnType<typeof listUnassignedEventRequests>
>[number];

async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/event-requests/drafts.server")]);
}

/**
 * Routes import this module, so it must stay free of any static server import — the middleware
 * pipeline is client-safe, and `./drafts.server` and `#/db` are both reached inside the handler,
 * which TanStack Start strips from the client build.
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
 * PTR-13: submits a saved draft by id, so the page never has to carry a payload that was not
 * stored. The same `event_request:create` the save path needs is the permission to submit one's
 * own request; the storage-level status scoping is what keeps it to that organiser's own draft.
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
 * PTR-14: every request the signed-in organiser created, drafts included, newest change first.
 * The organiser's own-request permission is `event_request:create` for the same reason it is on
 * `submitEventRequest`; the storage-level scoping to `organiserId` is what keeps the list to
 * their own rows until PTR-8 introduces relationship-based access.
 */
export const listEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCreate])
  .handler(async ({ context }) => {
    const [{ db }, { handleListEventRequests }] = await loadServer();
    return handleListEventRequests(context.user, db);
  });

/**
 * PTR-14 criterion 4: one of the organiser's requests as currently recorded. Wrapped in an
 * object for the reason `getVenue` gives — a nullable top-level result infers as `never` — and
 * `null` for a row that is not theirs as much as for one that does not exist, so the id space
 * reveals nothing.
 */
export const getEventRequest = createServerFn({ method: "GET" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetEventRequest }] = await loadServer();
    return { request: await handleGetEventRequest(data, context.user, db) };
  });

/**
 * PTR-15 criterion 5: the requests no Coordinator is handling, for any Event Coordinator to
 * open. PTR-16's assignment functions live in `coordination/server-fns.ts` and use the same
 * `event_request:coordinate` middleware, with current ownership checked in each handler.
 */
export const listUnassignedEventRequests = createServerFn({ method: "GET" })
  .middleware([requireEventRequestCoordinate])
  .handler(async () => {
    const [{ db }, { handleListUnassignedEventRequests }] = await loadServer();
    return handleListUnassignedEventRequests(db);
  });

/**
 * Criterion 2: fetches one owned draft so the edit route can seed the form with it. Wrapped in
 * an object for the reason `getEventRequest` gives — a nullable top-level result infers as
 * `never` — and `null` for a row that is not theirs, submitted, or absent.
 */
export const getEventRequestDraft = createServerFn({ method: "GET" })
  .validator(parseEventRequestId)
  .middleware([requireEventRequestCreate])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetEventRequestDraft }] = await loadServer();

    return { draft: await handleGetEventRequestDraft(data, context.user, db) };
  });

/** Criterion 3: deletes an owned draft; refuses a submitted one via the scoping in the handler. */
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
