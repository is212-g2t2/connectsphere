import { Card, CardContent } from "#/components/ui/card";
import { UpdateEventInformation } from "#/features/coordination/components/update-event-information";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import { canUpdateEventInformation } from "#/features/event-requests/schema";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";

const NONE = "None recorded";

/** The organiser's read-only record, mirroring the request detail's event information block. */
function OrganiserInformation({ request }: { request: EventRequestDetail }) {
  return (
    <div>
      <h2 className="display-h3">Event information</h2>
      <Card className="mt-4">
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
    </div>
  );
}

/**
 * The event's recorded information both staff roles read — updatable by the Coordinator while the
 * event is approved, planning, or confirmed.
 */
export function eventInformationSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event") return [];
  if (data.event.access !== "organiser" && data.event.access !== "coordinator") return [];
  const { access, event } = data.event;
  return [
    {
      id: "details",
      label: access === "coordinator" ? "Update event information" : "Event information",
      visible: () => access === "organiser" || canUpdateEventInformation(event.status),
      render: body => {
        if (body.kind !== "event") return null;
        if (body.event.access === "coordinator") {
          const request = body.coordination?.request;
          return request ? <UpdateEventInformation request={request} /> : null;
        }
        const request = body.organiserRequest;
        return request ? <OrganiserInformation request={request} /> : null;
      },
    },
  ];
}
