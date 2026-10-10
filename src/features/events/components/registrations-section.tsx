import { useCallback } from "react";

import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { AttendeeTable } from "#/features/events/components/attendee-table";
import { AddVipDialog, RemoveVipButton } from "#/features/events/components/vip-registrations";

/** The stages with a registration record to show: venue settled onward. */
const REGISTRATION_STATUSES: readonly EventRequestStatus[] = [
  "approved",
  "planning",
  "confirmed",
  "completed",
];

/** Whether the status leaves a registration record worth listing. */
export function hasRegistrationRecord(status: EventRequestStatus): boolean {
  return REGISTRATION_STATUSES.some(candidate => candidate === status);
}
/** The shared attendee list: places count and every registration in one table, always visible. */
function RegistrationsBody({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const { event } = data.event;
  const attendees = data.attendees ?? [];
  // Stable across renders, so the table keeps its column identity and its search and filter.
  const rowActions = useCallback(
    (attendee: (typeof attendees)[number]) =>
      attendee.vip ? (
        <RemoveVipButton
          eventId={event.id}
          vip={{
            attendeeId: attendee.attendeeId,
            name: attendee.name,
            email: attendee.email,
          }}
        />
      ) : null,
    [event.id]
  );
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="display-h3">Registrations</h2>
        {event.places && (
          <p className="body-sm text-muted-foreground">
            {`${event.places.registered} / ${event.places.capacity} registered` +
              (event.places.vip > 0 ? ` (+${event.places.vip} VIP)` : "")}
          </p>
        )}
      </div>

      <div className="mt-4">
        <AttendeeTable
          attendees={attendees}
          tableActions={<AddVipDialog eventId={event.id} />}
          rowActions={rowActions}
        />
      </div>
    </div>
  );
}

/**
 * The attendee list the Organiser and the Coordinator share. Before approval there is nobody to
 * list; a rejected or cancelled event keeps none.
 */
export function registrationsSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event") return [];
  if (data.event.access !== "organiser" && data.event.access !== "coordinator") return [];
  const { status } = data.event.event;
  return [
    {
      id: "registrations",
      label: "Registrations",
      visible: () => hasRegistrationRecord(status),
      render: body => body.kind === "event" && <RegistrationsBody data={body} />,
    },
  ];
}
