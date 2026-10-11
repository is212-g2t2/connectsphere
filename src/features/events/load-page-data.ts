import { can } from "#/features/auth/permissions";
import { getCoordinationRequest, listCoordinators } from "#/features/coordination/server-fns";
import { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
import { getEventRequest } from "#/features/event-requests/server-fns";
import { hasAttendeePage } from "#/features/events/access";
import type { EventProjection, RegisteredAttendee } from "#/features/events/access";
import { hasRegistrationRecord } from "#/features/events/components/registrations-section";
import type { EventPageData } from "#/features/events/page-data";
import { listEventRegistrations, listEvents } from "#/features/events/server-fns";
import { getPendingVenueRequest } from "#/features/venue-requests/server-fns";
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
    // No projection: a coordinator may still triage the underlying request when unassigned.
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
      const [coordination, attendees] = await Promise.all([
        Promise.all([getCoordinationRequest({ data: { id: eventId } }), listCoordinators()]).then(
          ([request, coordinators]) => ({ request, coordinators }),
          () => null
        ),
        loadAttendees(projection, eventId),
      ]);
      return { kind: "event", event: projection, viewerId, coordination, attendees };
    }
    case "venue_staff": {
      const venueRequest = projection.event.venueRequest;
      if (venueRequest?.status !== "pending") return { kind: "event", event: projection, viewerId };
      // A race can settle the request between the list and the detail read. The read then
      // answers `null`. The page shows the projection without a decision block. Log anything else
      // before the same degrade. The venue catalogue read needs no request data, so both run together.
      const [request, venues] = await Promise.all([
        getPendingVenueRequest({ data: { id: venueRequest.id } }).catch(error => {
          log.warn("Venue decision read failed", {
            eventId,
            requestId: venueRequest.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
        // Offer a suggested venue only to a role that may decide, as the detail route did.
        can(role, { venue_request: ["decide"] }) ? listVenueOptions() : Promise.resolve([]),
      ]);
      if (!request) return { kind: "event", event: projection, viewerId };
      return { kind: "event", event: projection, viewerId, venueDecision: { request, venues } };
    }
    case "technical_support": {
      // A catalogue fault must not take the page down. `null` lets the page report the failed list.
      const equipmentTypes = await listEquipmentTypes().catch(() => null);
      return { kind: "event", event: projection, viewerId, equipmentTypes };
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

/** Coordinator triage fallback: the request behind an event with no projection. */
async function loadTriage(
  eventId: number,
  role: string | null | undefined,
  viewerId: string
): Promise<EventPageData | null> {
  if (!can(role, { event_request: ["coordinate"] })) return null;
  try {
    const [request, coordinators] = await Promise.all([
      getCoordinationRequest({ data: { id: eventId } }),
      listCoordinators(),
    ]);
    return { kind: "triage", viewerId, request, coordinators };
  } catch (error) {
    // A refusal means the request settled or vanished under the fallback. Rethrow any other fault
    // for the route to see.
    if (error instanceof Error && error.message === "Forbidden") {
      log.info("Triage fallback refused", { eventId });
      return null;
    }
    throw error;
  }
}
