import { can } from "#/features/auth/permissions";
import {
  getCoordinationRequest,
  getOversightRequest,
  listCoordinators,
} from "#/features/coordination/server-fns";
import { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
import { getEventRequest } from "#/features/event-requests/server-fns";
import { hasAttendeePage } from "#/features/events/access";
import type { EventProjection, RegisteredAttendee } from "#/features/events/access";
import { hasRegistrationRecord } from "#/features/events/components/registrations-section";
import type { EventPageData } from "#/features/events/page-data";
import { listEventRegistrations, listEvents } from "#/features/events/server-fns";
import { getEventSafetyReview } from "#/features/safety-reviews/server-fns";
import { getPendingVenueRequestsForEvent } from "#/features/venue-requests/server-fns";
import { listVenueOptions } from "#/features/venues/server-fns";
import { logger } from "#/lib/logger";

const log = logger.getChild("event-page");

/**
 * Gather everything the universal event page needs per access. The route maps `null` to its 404.
 * A hidden, foreign, or missing event then reveals nothing.
 *
 * Keep this module client-safe. Import only server-function modules and pure permission and
 * access helpers. Import no `#/db`, so `client-bundle-safety` holds.
 */
export async function loadEventPageData(
  eventId: number,
  role: string | null | undefined,
  viewerId: string
): Promise<EventPageData | null> {
  let projections: EventProjection[];
  try {
    projections = await listEvents({ data: { eventId } });
  } catch (error) {
    // No projection. The Lead's unassigned detail reads on from here; every other caller resolves
    // to no page. Rethrow a genuine fault for the route to see.
    if (error instanceof Error && error.message === "Forbidden") {
      return loadTriage(eventId, role, viewerId);
    }
    throw error;
  }
  const projection = projections.at(0);
  if (!projection) return null;

  switch (projection.access) {
    case "attendee":
      // A registered attendee's non-published event stays listed but has no page.
      if (!hasAttendeePage(projection.event)) return null;
      return { kind: "event", event: projection, viewerId };
    case "organiser": {
      // Degrade each extra to `null` on failure. A failed read then leaves the page rendering
      // from the projection. The venue and tech branches do the same.
      const [organiserRequest, attendees] = await Promise.all([
        getEventRequest({ data: { id: eventId } }).then(
          ({ request }) => request,
          () => null
        ),
        loadAttendees(projection, eventId),
      ]);
      return { kind: "event", event: projection, viewerId, organiserRequest, attendees };
    }
    case "coordinator": {
      // PTR-145: the Coordinator no longer moves an assignment, so their page carries no
      // candidate list.
      const [coordination, attendees] = await Promise.all([
        getCoordinationRequest({ data: { id: eventId } }).then(
          request => ({ request }),
          () => null
        ),
        loadAttendees(projection, eventId),
      ]);
      return { kind: "event", event: projection, viewerId, coordination, attendees };
    }
    case "lead": {
      // PTR-144: a queue row — any unassigned non-draft request — opens the queue detail, which
      // carries the organiser, the purpose, the request record, and the waiting change or
      // cancellation requests. PTR-145 adds the assignment form there. An assigned event opens
      // the projection with the same read, so the Lead can reassign it.
      if (projection.event.awaitingAssignment === true) {
        return loadTriage(eventId, role, viewerId);
      }
      const coordination = await Promise.all([
        getOversightRequest({ data: { id: eventId } }),
        listCoordinators(),
      ])
        .then(([request, coordinators]) => ({ request, coordinators }))
        .catch(error => {
          log.warn("Lead coordination read failed", {
            eventId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
      return { kind: "event", event: projection, viewerId, coordination };
    }
    case "venue_staff": {
      // Load the full request of every pending entry in one read. A failed read logs and leaves
      // `venueDecisions` unset; each pending entry then renders read-only from the projection.
      // A request decided between the list and this read is missing from the result. The venue
      // catalogue read needs no request data, so it runs beside the request read.
      const hasPending = (projection.event.venueRequests ?? []).some(
        entry => entry.status === "pending"
      );
      if (!hasPending) return { kind: "event", event: projection, viewerId };
      const [requests, venues] = await Promise.all([
        getPendingVenueRequestsForEvent({ data: { eventId } }).catch((error: unknown) => {
          log.warn("Venue decision read failed", {
            eventId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
        // Offer a suggested venue only to a role that may decide, as the detail route did.
        can(role, { venue_request: ["decide"] }) ? listVenueOptions() : Promise.resolve([]),
      ]);
      return {
        kind: "event",
        event: projection,
        viewerId,
        venueDecisions: requests === null ? undefined : { requests, venues },
      };
    }
    case "technical_support": {
      // A catalogue fault must not take the page down. `null` lets the page report the failed list.
      const equipmentTypes = await listEquipmentTypes().catch(() => null);
      return { kind: "event", event: projection, viewerId, equipmentTypes };
    }
    case "safety_officer": {
      // PTR-146: the review the Safety Officer decides. A failed read leaves `safetyReview` unset,
      // so the page renders the event's facts without a decision form.
      const safetyReview = await getEventSafetyReview({ data: { id: eventId } }).catch(error => {
        log.warn("Safety review read failed", {
          eventId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
      return { kind: "event", event: projection, viewerId, safetyReview };
    }
    default:
      return null;
  }
}

/**
 * Load the registration list the Organiser and the Coordinator share. Skip the fetch for statuses
 * with no record. Degrade a failed read to `null`, like every other extra.
 */
async function loadAttendees(
  projection: EventProjection,
  eventId: number
): Promise<RegisteredAttendee[] | null | undefined> {
  if (!hasRegistrationRecord(projection.event.status)) return undefined;
  return listEventRegistrations({ data: { id: eventId } }).catch(() => null);
}

/**
 * PTR-144: the Lead's detail for an unassigned request, the queue's opened row. PTR-145 adds the
 * Coordinator candidates, so the Lead assigns from here.
 */
async function loadTriage(
  eventId: number,
  role: string | null | undefined,
  viewerId: string
): Promise<EventPageData | null> {
  if (!can(role, { event_request: ["oversee"] })) return null;
  try {
    const [request, coordinators] = await Promise.all([
      getOversightRequest({ data: { id: eventId } }),
      listCoordinators(),
    ]);
    return { kind: "triage", viewerId, request, coordinators };
  } catch (error) {
    // A refusal means the request settled or vanished under the fallback. Rethrow any other fault
    // for the route to see.
    if (error instanceof Error && error.message === "Forbidden") {
      log.info("Oversight detail refused", { eventId });
      return null;
    }
    throw error;
  }
}
