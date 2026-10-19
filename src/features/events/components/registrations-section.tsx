import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { formatInstant } from "#/features/event-requests/format";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { AttendeeTable } from "#/features/events/components/attendee-table";
import { AddVipDialog, RemoveVipButton } from "#/features/events/components/vip-registrations";
import type { RegisteredAttendee } from "#/features/events/access";
import { skipRootFilter } from "#/lib/invalidate";

/** Stages with a registration record to show: venue settled onward. */
const REGISTRATION_STATUSES: readonly EventRequestStatus[] = [
  "approved",
  "planning",
  "confirmed",
  "completed",
];

/** Check whether the status leaves a registration record worth listing. */
export function hasRegistrationRecord(status: EventRequestStatus): boolean {
  return REGISTRATION_STATUSES.some(candidate => candidate === status);
}

/** Format a waiting-list join time (`registeredAt`) for the list. Pass other shapes through. */
function formatJoined(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : formatInstant(new Date(time));
}
/** Shared attendee list: places count and every registration in one table. Always visible. */
function RegistrationsBody({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const { event } = data.event;
  const router = useRouter();
  // The list carries registrations and the waiting list together. Show registrations in the
  // table and the waiting list below it, each in the join order the query returns.
  const registered = (data.attendees ?? []).filter(attendee => attendee.status === "registered");
  const waitingList = (data.attendees ?? []).filter(attendee => attendee.status === "waitlisted");
  // Keep this stable across renders. The table then keeps its column identity, search, and filter.
  const rowActions = useCallback(
    (attendee: RegisteredAttendee) =>
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
        {data.attendees === null ? (
          <p role="alert" className="body-sm text-destructive">
            Could not load the registrations.{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                // A failed refetch leaves the alert in place. The click only retries the load.
                void router.invalidate({ filter: skipRootFilter }).catch(() => undefined);
              }}
            >
              Try again
            </Button>
          </p>
        ) : (
          <>
            <AttendeeTable
              attendees={registered}
              tableActions={<AddVipDialog eventId={event.id} />}
              rowActions={rowActions}
            />
            {waitingList.length > 0 ? (
              <div className="mt-8">
                <h3 className="font-semibold">Waiting list ({waitingList.length})</h3>
                {/* The list arrives in join order. Keep that order here. */}
                <ul className="mt-3 space-y-2">
                  {waitingList.map((attendee, index) => (
                    <li key={attendee.attendeeId} className="body-sm">
                      <span className="font-medium">
                        {index + 1}. {attendee.name || "Unnamed attendee"}
                      </span>{" "}
                      <span className="break-words text-muted-foreground">
                        {attendee.email} · waiting since {formatJoined(attendee.registeredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Share the attendee list between the Organiser and the Coordinator. Before approval there is
 * nobody to list. A rejected or cancelled event keeps none.
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
