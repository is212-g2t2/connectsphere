import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDateTime } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { RegisterAction } from "#/features/events/components/register-action";
import { WithdrawAction } from "#/features/events/components/withdraw-action";
import {
  JoinWaitingListAction,
  LeaveWaitingListAction,
} from "#/features/events/components/waiting-list-action";
import { REGISTRATION_NOT_OPEN_MESSAGE, eventFullMessage } from "#/features/events/registration";
import type { RegistrationAvailability } from "#/features/events/registration";
import { eventSchedule } from "#/features/events/schedule";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const MONTH_ABBR = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** One formatter instance reused for the page's long dates. */
const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Format a stored calendar date (`2026-12-05`) as `5 December 2026`-style prose. Parse as UTC
 * so the server render and the hydrated client agree. Pass other shapes through unchanged. */
function formatLongDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.exec(value)) return value;
  return LONG_DATE.format(new Date(`${value}T00:00:00Z`));
}

/** Build the date block's two lines from a stored calendar date with string arithmetic. */
function dateBlockParts(value: string): { month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { month: "", day: "" };
  const month = MONTH_ABBR[Number(match[2]) - 1] ?? "";
  return { month, day: String(Number(match[3])) };
}

/**
 * PTR-44: Show an Attendee a confirmed event with registration on, or a cancelled event they hold
 * a registration for (PTR-50 AC4). Show only the published fields: name, description, date and
 * time, the approved booking's venue, and the registration period. Booking decisions, equipment,
 * and clarification threads never reach this view.
 */
export function AttendeeEventPage({ event }: { event: EventProjection }) {
  const { event: details } = event;
  // Prefer a current approved booking over the original proposal.
  const { date, endDate, startTime, endTime, spansDays, crossesMidnight } = eventSchedule(details);
  const isRegistered = details.registration?.status === "registered";
  const isWaitlisted = details.registration?.status === "waitlisted";
  // Mirror the cancelled leg of the route's `hasAttendeePage`. The page and the route then agree.
  const isCancelled = details.status === "cancelled";
  // Completed events take no activity writes. The page offers no withdrawal for them.
  const isCompleted = details.status === "completed";
  const availability = details.registrationAvailability;
  // Show the window in chronological order; the close date still follows the open date.
  const period =
    details.registrationOpensAt && details.registrationClosesAt ? (
      <>
        <p className="mt-1 body-sm text-muted-foreground">
          Registration opens {formatLocalDateTime(details.registrationOpensAt)}
        </p>
        <p className="mt-1 body-sm text-muted-foreground">
          Registration closes {formatLocalDateTime(details.registrationClosesAt)}
        </p>
      </>
    ) : null;
  // PTR-45 AC10: Places taken, against the lower of the registration capacity and the venue
  // places left after VIPs (PTR-111).
  const places = details.places ? (
    <p className="mt-1 body-sm text-muted-foreground">
      {`${details.places.registered} / ${details.places.limit} registered`}
    </p>
  ) : null;
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>
      <div className="mt-6 grid gap-8 split:grid-cols-[300px_minmax(0,1fr)] split:gap-12">
        <aside>
          <div className="relative aspect-video overflow-hidden rounded-2xl cover-art shadow-card">
            <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
            {/* The h1 below repeats the name, so the overlay caption stays a desktop accent. */}
            <p
              aria-hidden="true"
              className="absolute bottom-0 left-0 hidden p-5 display-h3 font-semibold text-white split:block"
            >
              {details.name ?? "Event"}
            </p>
          </div>
        </aside>

        {/* Date and venue lead at every width; the 16:9 cover already shortens the page. */}
        <div className="flex min-w-0 flex-col">
          <div className="order-1 flex items-center gap-2">
            <EventRequestStatusBadge status={details.status} />
          </div>
          <h1 className="order-1 mt-3 font-semibold event-title">{details.name ?? "Event"}</h1>

          {date ? (
            <div className="order-2 mt-6 flex items-start gap-3 split:order-2">
              <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-md border border-input bg-card">
                <span className="caption tracking-wide text-muted-foreground">
                  {dateBlockParts(date).month}
                </span>
                <span className="text-base font-semibold">{dateBlockParts(date).day}</span>
              </span>
              <div className="min-w-0">
                <p className="font-semibold">
                  {spansDays && endDate
                    ? `${formatLongDate(date)} – ${formatLongDate(endDate)}`
                    : formatLongDate(date)}
                </p>
                <p className="body-sm text-muted-foreground">
                  {startTime && endTime
                    ? crossesMidnight
                      ? `${startTime} – ${endTime} (next day)`
                      : `${startTime}–${endTime}`
                    : "Time to be confirmed"}
                </p>
              </div>
            </div>
          ) : (
            <p className="order-2 mt-6 font-semibold split:order-2">Date to be confirmed</p>
          )}

          {/* Leave the venue row out for a cancelled event. Once its booking is released, the row
              would say that the venue is still to be confirmed. */}
          {isCancelled ? null : (
            <div className="order-2 mt-4 flex items-start gap-3 split:order-2">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-input bg-card">
                <MapPin className="size-4" />
              </span>
              <div className="min-w-0">
                {details.venue ? (
                  <>
                    <p className="font-semibold">{details.venue.name}</p>
                    {details.venue.location ? (
                      <p className="body-sm text-muted-foreground">{details.venue.location}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="font-semibold">Venue to be confirmed</p>
                )}
              </div>
            </div>
          )}

          <Card className="order-3 mt-6 split:order-3">
            <CardContent>
              <p className="label text-muted-foreground">Registration</p>
              {isCancelled ? (
                <>
                  <p className="mt-2 font-semibold">This event is cancelled.</p>
                  {isRegistered ? (
                    <p className="mt-1 body-sm text-muted-foreground">
                      You were registered for this event.
                    </p>
                  ) : null}
                </>
              ) : isRegistered ? (
                <>
                  <p className="mt-2 font-semibold">You&apos;re registered</p>
                  {period}
                  {places}
                  {!isCompleted ? (
                    <WithdrawAction eventId={details.id} eventName={details.name ?? "this event"} />
                  ) : null}
                </>
              ) : isWaitlisted ? (
                <>
                  <p className="mt-2 font-semibold">You&apos;re on the waiting list</p>
                  <p className="mt-1 body-sm text-muted-foreground">
                    We&apos;ll notify you when a place opens. Places go first come, first served.
                  </p>
                  {period}
                  {places}
                  {availability?.state === "open" && !isCompleted ? (
                    <RegisterAction eventId={details.id} eventName={details.name ?? "this event"} />
                  ) : null}
                  {!isCompleted ? <LeaveWaitingListAction eventId={details.id} /> : null}
                </>
              ) : period ? (
                <>
                  {period}
                  {/* VIPs can fill the venue after normal places run out. A full event can then show
                      more registrations than places. Show the reason instead of the count. */}
                  {availability?.state === "full" ? null : places}
                  {availability?.state === "open" ? (
                    <RegisterAction eventId={details.id} eventName={details.name ?? "this event"} />
                  ) : availability?.state === "full" ? (
                    <>
                      <RegistrationUnavailable availability={availability} />
                      <JoinWaitingListAction
                        eventId={details.id}
                        eventName={details.name ?? "this event"}
                      />
                    </>
                  ) : (
                    <RegistrationUnavailable availability={availability} />
                  )}
                </>
              ) : (
                <p className="mt-2 body-sm text-muted-foreground">
                  Registration details to be confirmed
                </p>
              )}
            </CardContent>
          </Card>

          {details.description ? (
            <section aria-label="About Event" className="order-4 mt-6">
              <h2 className="font-semibold display-h3">About Event</h2>
              <p className="mt-2 max-w-prose body-sm whitespace-pre-line text-muted-foreground">
                {details.description}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

/**
 * PTR-50 AC1–AC3: Say why the Attendee cannot register now, in place of the register action. The
 * server applies the same rule. A stale page that still shows the action meets the same refusal.
 */
function RegistrationUnavailable({
  availability,
}: {
  availability: RegistrationAvailability | null | undefined;
}) {
  const sentence = "mt-4 body-sm font-semibold";
  switch (availability?.state) {
    // AC1: The period line above the sentence shows the opening date and time.
    case "not_yet_open":
      return <p className={sentence}>Registration is not yet open.</p>;
    case "closed":
      return <p className={sentence}>Registration has closed.</p>;
    case "full":
      return <p className={sentence}>{eventFullMessage(availability.venueCapacity)}</p>;
    default:
      return <p className={sentence}>{REGISTRATION_NOT_OPEN_MESSAGE}</p>;
  }
}
