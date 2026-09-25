import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseVenueRequestContext,
  parseVenueRequestId,
  parseVenueRequestInput,
} from "#/features/venue-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("venue-requests");

/**
 * Routes import this module, so it stays free of any static server import — the middleware
 * pipeline is client-safe, and `./requests.server` and `#/db` are reached inside the handlers,
 * which TanStack Start strips from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/venue-requests/requests.server")]);
}

/**
 * PTR-31: what an Event Coordinator holds when asking about, raising, or withdrawing a booking
 * request. The handler re-reads the event's assignment, so the function grants the role its
 * verbs, never a specific event.
 */
export const requireVenueRequest = requirePermission({ venue_request: ["request"] });

/** PTR-32: Venue Staff may read the shared pending queue without gaining the approval verb. */
export const requireVenueRequestRead = requirePermission({ venue_request: ["read"] });

export const listPendingVenueRequests = createServerFn({ method: "GET" })
  .middleware([requireVenueRequestRead])
  .handler(async () => {
    const [{ db }, { handleListPendingVenueRequests }] = await loadServer();
    return handleListPendingVenueRequests(db);
  });

export type PendingBookingRequest = Awaited<ReturnType<typeof listPendingVenueRequests>>[number];

export const getPendingVenueRequest = createServerFn({ method: "GET" })
  .validator(parseVenueRequestId)
  .middleware([requireVenueRequestRead])
  .handler(async ({ data }) => {
    const [{ db }, { handleGetPendingVenueRequest }] = await loadServer();
    return handleGetPendingVenueRequest(data, db);
  });

export type PendingBookingRequestDetail = NonNullable<
  Awaited<ReturnType<typeof getPendingVenueRequest>>
>;

/**
 * The venue page's read. Wrapped in `{ context }` for the reason `getVenue` documents: a nullable
 * top-level result infers as `never`. A `null` context is an ordinary answer — the venue page
 * renders without the request panel — not a refusal the route has to handle.
 */
export const getVenueRequestContext = createServerFn({ method: "GET" })
  .validator(parseVenueRequestContext)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetVenueRequestContext }] = await loadServer();
    return { context: await handleGetVenueRequestContext(data, context.user, db) };
  });

/** The panel's props as the client sees them — derived here, so no route imports the server module. */
export type VenueRequestContext = NonNullable<
  Awaited<ReturnType<typeof getVenueRequestContext>>["context"]
>;

export const requestVenue = createServerFn({ method: "POST" })
  .validator(parseVenueRequestInput)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCreateVenueRequest }] = await loadServer();
    const request = await handleCreateVenueRequest(data, context.user, db);

    log.info("Venue request created", {
      requestId: request.id,
      eventId: request.eventId,
      venueId: request.venueId,
      actorId: context.user.id,
    });

    return request;
  });

export const withdrawVenueRequest = createServerFn({ method: "POST" })
  .validator(parseVenueRequestId)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleWithdrawVenueRequest }] = await loadServer();
    const request = await handleWithdrawVenueRequest(data, context.user, db);

    log.info("Venue request withdrawn", {
      requestId: request.id,
      eventId: request.eventId,
      actorId: context.user.id,
    });

    return request;
  });

/**
 * PTR-36: the Venue Staff verb that settles a pending request. The handler re-reads the queue
 * rule, so the function grants the role its verb, never a specific row.
 */
export const requireVenueDecision = requirePermission({ venue_request: ["decide"] });

export const approveVenueRequest = createServerFn({ method: "POST" })
  .validator(parseVenueRequestId)
  .middleware([requireVenueDecision])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleApproveVenueRequest }] = await loadServer();
    const request = await handleApproveVenueRequest(data, context.user, db);

    log.info("Venue request approved", {
      requestId: request.id,
      eventId: request.eventId,
      venueId: request.venueId,
      actorId: context.user.id,
    });

    return request;
  });
