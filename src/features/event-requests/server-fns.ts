import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import { parseDraftInput, parseEventRequestId } from "#/features/event-requests/schema";

export const requireEventRequestCreate = requirePermission({ event_request: ["create"] });

/** A saved draft as the client sees it — derived here so no route has to import the server module. */
export type EventRequestDraft = Awaited<ReturnType<typeof saveEventRequestDraft>>;

/** One of the organiser's requests as the list and detail pages see it (PTR-14). */
export type EventRequestSummary = Awaited<ReturnType<typeof listEventRequests>>[number];

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

    return handleSubmitEventRequest(data, context.user, db);
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
