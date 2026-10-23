import type { ReactNode } from "react";

import { Card, CardContent } from "#/components/ui/card";
import { CoordinatorInformationForm } from "#/features/coordination/components/change-request-decisions";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import { canUpdateEventInformation } from "#/features/event-requests/schema";
import type { EventProjection } from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import {
  formatInstant,
  formatLocalDate,
  formatLocalDateTime,
  formatProposedWindow,
} from "#/features/event-requests/format";

const NONE = "None recorded";

/**
 * The collapsed record shell: a heading with the record behind a disclosure, so the page's
 * request and decision blocks stay above a long read-only mirror.
 */
function InformationDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="display-h3">{title}</h2>
      <details className="mt-4">
        <summary className="w-fit cursor-pointer body-sm text-muted-foreground">
          Show details
        </summary>
        <div className="mt-4">{children}</div>
      </details>
    </div>
  );
}

/** The Organiser's read-only record. It mirrors the request detail's event information block. */
function OrganiserInformation({ request }: { request: EventRequestDetail }) {
  return (
    <InformationDisclosure title="Event information">
      <Card>
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Expected attendance">{request.expectedAttendance ?? NONE}</Detail>

            <Detail term="Purpose" wide>
              {request.purpose || NONE}
            </Detail>

            <Detail term="Proposed dates and times" wide>
              {request.proposedDates.length === 0 ? (
                NONE
              ) : (
                <ul className="space-y-1">
                  {request.proposedDates.map(window => (
                    <li key={`${window.start ?? ""}-${window.end ?? ""}`}>
                      {formatProposedWindow(window)}
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail term="Type of event">{request.eventType || NONE}</Detail>
            <Detail term="Room-layout preference">{request.roomLayoutPreference || NONE}</Detail>
            <Detail term="Description" wide>
              {request.description || NONE}
            </Detail>
            <Detail term="Venue requirements" wide>
              {request.venueRequirements || NONE}
            </Detail>
            <Detail term="Accessibility requirements" wide>
              {request.accessibilityRequirements || NONE}
            </Detail>
            <Detail term="Special arrangements" wide>
              {request.specialArrangements || NONE}
            </Detail>

            <Detail term="Equipment requirements" wide>
              {request.equipmentRequirements.length === 0 ? (
                NONE
              ) : (
                <ul className="space-y-1">
                  {request.equipmentRequirements.map(line => (
                    <li key={`${line.type}-${line.quantity ?? ""}`}>
                      {line.type || "Unnamed equipment"}
                      {line.quantity === undefined ? "" : ` × ${line.quantity}`}
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail term="Attendee registration" wide>
              {request.registrationEnabled ? (
                <ul className="space-y-1">
                  <li>Capacity {request.registrationCapacity}</li>
                  <li>
                    Opens {formatLocalDateTime(request.registrationOpensAt ?? "")}, closes{" "}
                    {formatLocalDateTime(request.registrationClosesAt ?? "")}
                  </li>
                </ul>
              ) : (
                "Not required"
              )}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </InformationDisclosure>
  );
}

/**
 * PTR-144: the Event Coordinator Lead's read-only record, rendered from the projection alone. The
 * Lead holds no action, so the card lists what the event records and nothing else.
 */
function LeadInformation({ event }: { event: EventProjection["event"] }) {
  const timing =
    event.eventDate === null
      ? NONE
      : `${formatLocalDate(event.eventDate)}${
          event.endDate && event.endDate !== event.eventDate
            ? ` – ${formatLocalDate(event.endDate)}`
            : ""
        }${event.startTime && event.endTime ? `, ${event.startTime}–${event.endTime}` : ""}`;
  return (
    <InformationDisclosure title="Event information">
      <Card>
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Expected attendance">{event.expectedAttendance ?? NONE}</Detail>

            <Detail term="Proposed dates and times" wide>
              {timing}
            </Detail>

            <Detail term="Room-layout preference">{event.layout || NONE}</Detail>
            <Detail term="Description" wide>
              {event.description || NONE}
            </Detail>
            <Detail term="Venue requirements" wide>
              {event.requiredFacilities || NONE}
            </Detail>
            <Detail term="Accessibility requirements" wide>
              {event.accessibilityRequirements || NONE}
            </Detail>

            <Detail term="Equipment" wide>
              {event.equipment === undefined || event.equipment.length === 0 ? (
                NONE
              ) : (
                <ul className="space-y-1">
                  {event.equipment.map(line => (
                    <li key={line.id}>
                      {line.item} × {line.quantity} ({line.arrangementStatus.replaceAll("_", " ")})
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail term="Attendee registration" wide>
              {event.registrationEnabled ? (
                <ul className="space-y-1">
                  <li>
                    Opens {formatLocalDateTime(event.registrationOpensAt ?? "")}, closes{" "}
                    {formatLocalDateTime(event.registrationClosesAt ?? "")}
                  </li>
                </ul>
              ) : (
                "Not required"
              )}
            </Detail>

            {event.confirmation ? (
              <Detail term="Booking" wide>
                {event.confirmation.venue
                  ? `${event.confirmation.venue.name}, ${formatLocalDate(
                      event.confirmation.venue.date
                    )}, ${event.confirmation.venue.startTime}–${event.confirmation.venue.endTime}. `
                  : "The booking has been released. "}
                Confirmed {formatInstant(new Date(event.confirmation.confirmedAt))} by{" "}
                {event.confirmation.confirmedByName}.
              </Detail>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </InformationDisclosure>
  );
}

/**
 * Show the event's recorded information to every staff role that reads it. The Coordinator can
 * update it while the event is approved, planning, or confirmed; in those statuses the form also
 * applies a waiting change request (PTR-52). In other statuses the change requests section holds
 * that form. The Organiser and the Lead (PTR-144) read the record only.
 */
export function eventInformationSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event") return [];
  if (
    data.event.access !== "organiser" &&
    data.event.access !== "coordinator" &&
    data.event.access !== "lead"
  ) {
    return [];
  }
  const { access } = data.event;
  return [
    {
      id: "details",
      label: access === "coordinator" ? "Update event information" : "Event information",
      visible: inner => {
        if (inner.kind !== "event") return false;
        if (inner.event.access === "organiser") {
          return inner.organiserRequest !== null && inner.organiserRequest !== undefined;
        }
        if (inner.event.access === "coordinator") {
          return (
            canUpdateEventInformation(inner.event.event.status) &&
            inner.coordination?.request !== undefined
          );
        }
        if (inner.event.access === "lead") return true;
        return false;
      },
      render: body => {
        if (body.kind !== "event") return null;
        if (body.event.access === "lead") {
          return <LeadInformation event={body.event.event} />;
        }
        if (body.event.access === "coordinator") {
          const request = body.coordination?.request;
          // The form owns its own disclosure and heading; do not nest a second one.
          return request ? <CoordinatorInformationForm request={request} /> : null;
        }
        const request = body.organiserRequest;
        return request ? <OrganiserInformation request={request} /> : null;
      },
    },
  ];
}
