import { createServerFn } from "@tanstack/react-start";

import { requirePermission } from "#/features/auth/session";
import {
  parseVenueHoldId,
  parseVenueHoldInput,
  parseVenueRejectionInput,
  parseVenueAmendmentInput,
  parseVenueReleaseInput,
  parseVenueRequestContext,
  parseVenueRequestEventInput,
  parseVenueRequestId,
  parseVenueRequestInput,
} from "#/features/venue-requests/schema";
import { logger } from "#/lib/logger";

const log = logger.getChild("venue-requests");

/**
 * Routes import this module, so do not add static server imports here. Middleware must remain
 * client-safe. Handlers import `./requests.server` and `#/db` dynamically; TanStack Start removes
 * handlers from the client build.
 */
async function loadServer() {
  return Promise.all([import("#/db"), import("#/features/venue-requests/requests.server")]);
}

async function loadBookingServer() {
  return Promise.all([import("#/db"), import("#/features/venue-requests/bookings.server")]);
}

/**
 * PTR-31: The Event Coordinator's access when they view, raise, or withdraw a booking request.
 * The handler re-reads the event assignment. This function grants role permissions, not access to
 * a specific event.
 */
export const requireVenueRequest = requirePermission({ venue_request: ["request"] });

/** PTR-32: Venue Staff may read the shared pending queue without gaining the approval verb. */
export const requireVenueRequestRead = requirePermission({ venue_request: ["read"] });

/** A pending row as the decision controls read it. */
export type PendingVenueRequest = Omit<PendingVenueRequestDetail, "requirements">;

/** PTR-32 AC3, PTR-138: every pending request of one event in the caller's queue, in one read. */
export const getPendingVenueRequestsForEvent = createServerFn({ method: "GET" })
  .validator(parseVenueRequestEventInput)
  .middleware([requireVenueRequestRead])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetPendingVenueRequestsForEvent }] = await loadServer();
    return handleGetPendingVenueRequestsForEvent(data, context.user, db);
  });

/** One pending request with its venue, period, conflict, and the event's requirements. */
export type PendingVenueRequestDetail = Awaited<
  ReturnType<typeof getPendingVenueRequestsForEvent>
>[number];

/**
 * Read the context for the venue page. Return it in `{ context }` because a nullable top-level
 * result infers as `never`, as `getVenue` documents. A `null` context means the page omits the
 * request panel; it is not a refusal.
 */
export const getVenueRequestContext = createServerFn({ method: "GET" })
  .validator(parseVenueRequestContext)
  .middleware([requireVenueRequest])
  .handler(async ({ data, context }) => {
    const [{ db }, { handleGetVenueRequestContext }] = await loadServer();
    return { context: await handleGetVenueRequestContext(data, context.user, db) };
  });

/** The panel props for the client. Derive them here so routes do not import the server module. */
export type VenueRequestContext = NonNullable<
  Awaited<ReturnType<typeof getVenueRequestContext>>["context"]
>;

/** One pending request or approved booking of the event at this venue, as the panel lists it. */
export type VenueRequestContextRow = VenueRequestContext["requests"][number];

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
 * PTR-36: The Venue Staff permission to approve a pending request. The handler checks the queue
 * again, so this function grants a role permission, not access to a specific row.
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
