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
 * Everything the universal event page needs, gathered per access. The route calls this and maps
 * `null` to its 404, so a hidden, foreign, or nonexistent event reveals nothing.
 *
 * Client-safe on purpose: only the server-function modules and the pure permission and access
 * helpers — no `#/db`, so `client-bundle-safety` holds.
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
      // Each extra degrades to `null` on failure, so a failed read leaves the page rendering
      // from the projection rather than 500ing it, as the venue and tech branches do.
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
      // A race settles the request between the list and the detail read; the read then answers
      // `null` and the page shows the projection without a decision block. Anything else is
      // unexpected, so it is logged before the same degrade.
      const request = await getPendingVenueRequest({ data: { id: venueRequest.id } }).catch(
        error => {
          log.warn("Venue decision read failed", {
            eventId,
            requestId: venueRequest.id,
            reason: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      );
      if (!request) return { kind: "event", event: projection, viewerId };
      // Only a role that may decide offers a suggested venue, as the detail route did.
      const venues = can(role, { venue_request: ["decide"] }) ? await listVenueOptions() : [];
      return { kind: "event", event: projection, viewerId, venueDecision: { request, venues } };
    }
    case "technical_support": {
      // A catalogue fault must not take the page down; `null` lets it say the list failed.
      const equipmentTypes = await listEquipmentTypes().catch(() => null);
      return { kind: "event", event: projection, viewerId, equipmentTypes };
    }
    default:
      return null;
  }
}

/**
 * The registration list the organiser and the coordinator share. Statuses with no record skip
 * the fetch entirely; a failed read degrades to `null` like every other extra.
 */
async function loadAttendees(
  projection: EventProjection,
  eventId: number
): Promise<RegisteredAttendee[] | null | undefined> {
  if (!hasRegistrationRecord(projection.event.status)) return undefined;
  return listEventRegistrations({ data: { id: eventId } }).catch(() => null);
}

/** The coordinator triage fallback: the request behind an event no projection covers. */
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
    // A refusal means the request settled or vanished under the fallback; anything else is a
    // fault the route must see.
    if (error instanceof Error && error.message === "Forbidden") {
      log.info("Triage fallback refused", { eventId });
      return null;
    }
    throw error;
  }
}
