import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseVenueHoldId,
  parseVenueHoldInput,
  parseVenueRejectionInput,
  parseVenueAmendmentInput,
  parseVenueReleaseInput,
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

async function loadBookingServer() {
  return Promise.all([import("#/db"), import("#/features/venue-requests/bookings.server")]);
}

/**
 * PTR-31: what an Event Coordinator holds when asking about, raising, or withdrawing a booking
 * request. The handler re-reads the event's assignment, so the function grants the role its
 * verbs, never a specific event.
 */
export const requireVenueRequest = requirePermission({ venue_request: ["request"] });

/** PTR-32: Venue Staff may read the shared pending queue without gaining the approval verb. */
export const requireVenueRequestRead = requirePermission({ venue_request: ["read"] });

/** A pending row as the queue table and the decision controls read it. */
export type PendingVenueRequest = Omit<PendingVenueRequestDetail, "requirements">;

export const getPendingVenueRequest = createServerFn({ method: "GET" })
  .validator(parseVenueRequestId)
  .middleware([requireVenueRequestRead])
  .handler(async ({ data }) => {
    const [{ db }, { handleGetPendingVenueRequest }] = await loadServer();
    return handleGetPendingVenueRequest(data, db);
  });

export type PendingVenueRequestDetail = NonNullable<
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

/** PTR-34: the same Venue Staff verb settles a request the other way, with a reason and any suggestion. */
export const rejectVenueRequest = createServerFn({ method: "POST" })
  .validator(parseVenueRejectionInput)
  .middleware([requireVenueDecision])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleRejectVenueRequest }] = await loadServer();
    const request = await handleRejectVenueRequest(data, context.user, db);

    log.info("Venue request rejected", {
      requestId: request.id,
      eventId: request.eventId,
      venueId: request.venueId,
      actorId: context.user.id,
    });

    return request;
  });

/** PTR-37: Venue Staff share the approved bookings their venues hold, upcoming first. */
export const listVenueBookings = createServerFn({ method: "GET" })
  .middleware([requireVenueDecision])
  .handler(async () => {
    const [{ db }, { handleListVenueBookings }] = await loadBookingServer();
    return handleListVenueBookings(db);
  });

export type VenueBooking = Awaited<ReturnType<typeof listVenueBookings>>[number];

/** PTR-37: release an approved booking and free its venue period. */
export const releaseVenueBooking = createServerFn({ method: "POST" })
  .validator(parseVenueReleaseInput)
  .middleware([requireVenueDecision])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleReleaseVenueBooking }] = await loadBookingServer();
    return handleReleaseVenueBooking(data, context.user, db);
  });

/** PTR-37: amend an approved booking using PTR-36's strict overlap rule. */
export const amendVenueBooking = createServerFn({ method: "POST" })
  .validator(parseVenueAmendmentInput)
  .middleware([requireVenueDecision])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleAmendVenueBooking }] = await loadBookingServer();
    return handleAmendVenueBooking(data, context.user, db);
  });

async function loadHoldsServer() {
  return Promise.all([import("#/db"), import("#/features/venue-requests/holds.server")]);
}

/**
 * PTR-109: Coordinator places a tentative hold naming venue and period.
 */
export const createVenueHold = createServerFn({ method: "POST" })
  .validator(parseVenueHoldInput)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleCreateVenueHold }] = await loadHoldsServer();
    const hold = await handleCreateVenueHold(data, context.user, db);

    log.info("Venue hold created", {
      holdId: hold.id,
      eventId: hold.eventId,
      venueId: hold.venueId,
      actorId: context.user.id,
    });

    return hold;
  });

/**
 * PTR-109: Coordinator releases an active tentative hold.
 */
export const releaseVenueHold = createServerFn({ method: "POST" })
  .validator(parseVenueHoldId)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleReleaseVenueHold }] = await loadHoldsServer();
    const hold = await handleReleaseVenueHold(data, context.user, db);

    log.info("Venue hold released", {
      holdId: hold.id,
      actorId: context.user.id,
    });

    return hold;
  });

/**
 * PTR-109: Coordinator converts a tentative hold to a pending venue booking request.
 */
export const convertVenueHold = createServerFn({ method: "POST" })
  .validator(parseVenueHoldId)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleConvertVenueHold }] = await loadHoldsServer();
    const result = await handleConvertVenueHold(data, context.user, db);

    log.info("Venue hold converted", {
      holdId: result.hold.id,
      requestId: result.request.id,
      actorId: context.user.id,
    });

    return result;
  });
