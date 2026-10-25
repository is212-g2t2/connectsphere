import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { CoordinatorInformationForm } from "#/features/coordination/components/change-request-decisions";
import { Detail } from "#/features/event-requests/components/request-message-blocks";
import {
  ACTUAL_ATTENDANCE_MAX_MESSAGE,
  ACTUAL_ATTENDANCE_MESSAGE,
  ATTENDANCE_MAX,
  canUpdateEventInformation,
  parseWholeNumber,
} from "#/features/event-requests/schema";
import type { EventProjection } from "#/features/events/access";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { updateEventAttendance } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";
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
            {request.status === "completed" && (
              <Detail term="Actual attendance">{request.actualAttendance ?? "Not recorded"}</Detail>
            )}

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
 * PTR-157 AC3: the assigned Coordinator sets or corrects the turnout on a completed event.
 * A blank field clears the count to "Not recorded"; the save sends the field omitted, and the
 * server clears it to null. The text input keeps invalid text visible, so it blocks the save
 * instead of clearing the count as a number input would.
 */
export function UpdateAttendanceForm({
  eventId,
  initial,
}: {
  eventId: number;
  initial: number | null;
}) {
  const router = useRouter();
  const [attendance, setAttendance] = useState(initial === null ? "" : String(initial));
  const trimmed = attendance.trim();
  const parsed = trimmed === "" ? null : parseWholeNumber(trimmed);
  const overLimit = parsed !== null && !Number.isNaN(parsed) && parsed > ATTENDANCE_MAX;
  const invalid = parsed !== null && (Number.isNaN(parsed) || overLimit);
  const clearing = parsed === null;
  const [result, save, saving] = useMutation(async () => {
    // A blank field sends the count omitted, and the server clears it to null.
    await updateEventAttendance({
      data: { id: eventId, ...(parsed === null ? {} : { actualAttendance: parsed }) },
    });
    let reloadFailed = false;
    try {
      await router.invalidate({ filter: skipRootFilter });
    } catch {
      // The save committed; only the re-read failed.
      reloadFailed = true;
      toast.warning(
        clearing
          ? "Attendance cleared. Refresh this page to see it."
          : "Attendance saved. Refresh this page to see it."
      );
    }
    if (!reloadFailed) {
      toast.success(clearing ? "Attendance cleared." : "Actual attendance saved.");
    }
  }, "Could not save actual attendance. Try again.");

  return (
    <form
      noValidate
      className="mt-4 max-w-xs space-y-3"
      onSubmit={event => {
        event.preventDefault();
        if (saving || invalid) return;
        void save();
      }}
    >
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor={`actual-attendance-${eventId}`}>Actual attendance</FieldLabel>
        <Input
          id={`actual-attendance-${eventId}`}
          type="text"
          inputMode="numeric"
          placeholder="e.g. 42"
          value={attendance}
          aria-invalid={invalid}
          onChange={event => setAttendance(event.target.value)}
        />
        <FieldDescription>
          Leave blank to clear the recorded turnout; it then shows as &ldquo;Not recorded&rdquo;.
        </FieldDescription>
        <FieldError
          errors={
            invalid
              ? [{ message: overLimit ? ACTUAL_ATTENDANCE_MAX_MESSAGE : ACTUAL_ATTENDANCE_MESSAGE }]
              : []
          }
        />
      </Field>
      <Button type="submit" size="sm" disabled={saving || invalid}>
        {saving ? "Saving…" : "Save attendance"}
      </Button>
      {result.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  );
}

/**
 * PTR-157: the Coordinator's turnout record for a completed event. The update form
 * closes with the event, so expected and actual attendance show here with a correction form.
 */
function CoordinatorCompletedRecord({ event }: { event: EventProjection["event"] }) {
  return (
    <div>
      <h2 className="display-h3">Event record</h2>
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            <Detail term="Expected attendance">{event.expectedAttendance ?? NONE}</Detail>
            <Detail term="Actual attendance">{event.actualAttendance ?? "Not recorded"}</Detail>
          </dl>
          <UpdateAttendanceForm eventId={event.id} initial={event.actualAttendance ?? null} />
        </CardContent>
      </Card>
    </div>
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
  const coordinatorCompleted = access === "coordinator" && data.event.event.status === "completed";
  return [
    {
      id: "details",
      label:
        access === "coordinator"
          ? coordinatorCompleted
            ? "Event record"
            : "Update event information"
          : "Event information",
      visible: inner => {
        if (inner.kind !== "event") return false;
        if (inner.event.access === "organiser") {
          return inner.organiserRequest !== null && inner.organiserRequest !== undefined;
        }
        if (inner.event.access === "coordinator") {
          // The completed record reads the projection alone, so a failed coordination read
          // must not hide it. The update form still needs the request.
          if (inner.event.event.status === "completed") return inner.coordination !== undefined;
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
          if (canUpdateEventInformation(body.event.event.status)) {
            const request = body.coordination?.request;
            // The form owns its own disclosure and heading; do not nest a second one.
            return request ? (
              <CoordinatorInformationForm request={request} layouts={body.layouts} />
            ) : null;
          }
          if (body.event.event.status === "completed") {
            return <CoordinatorCompletedRecord event={body.event.event} />;
          }
          return null;
        }
        const request = body.organiserRequest;
        return request ? <OrganiserInformation request={request} /> : null;
      },
    },
  ];
}
