import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDateTime } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { RegisterAction } from "#/features/events/components/register-action";
import { WithdrawAction } from "#/features/events/components/withdraw-action";
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

/** A stored calendar date (`2026-12-05`) as `5 December 2026`-style prose, parsed as UTC so the
 * server render and the hydrated client agree. Anything not in that shape passes through. */
function formatLongDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.exec(value)) return value;
  return LONG_DATE.format(new Date(`${value}T00:00:00Z`));
}

/** The date block's two lines from a stored calendar date, by string arithmetic. */
function dateBlockParts(value: string): { month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { month: "", day: "" };
  const month = MONTH_ABBR[Number(match[2]) - 1] ?? "";
  return { month, day: String(Number(match[3])) };
}

/**
 * PTR-44: what an attendee sees of a confirmed event with registration on, or of a cancelled event
 * they hold a registration for (PTR-50 AC4). Only the published fields — name, description,
 * date/time, the approved booking's venue, and the registration period — so booking decisions,
 * equipment, and clarification threads never reach this view.
 */
export function AttendeeEventPage({ event }: { event: EventProjection }) {
  const { event: details } = event;
  // A current approved booking takes precedence over the original proposal.
  const { date, endDate, startTime, endTime, spansDays, crossesMidnight } = eventSchedule(details);
  const isRegistered = details.registration?.status === "registered";
  // The cancelled leg of the route's `hasAttendeePage`, so the page and the route cannot disagree.
  const isCancelled = details.status === "cancelled";
  // Completed events take no activity writes, so the page offers no withdrawal for one.
  const isCompleted = details.status === "completed";
  const availability = details.registrationAvailability;
  const period =
    details.registrationOpensAt && details.registrationClosesAt ? (
      <p className="mt-1 body-sm text-muted-foreground">
        Opens {formatLocalDateTime(details.registrationOpensAt)} – closes{" "}
        {formatLocalDateTime(details.registrationClosesAt)}
      </p>
    ) : null;
  // PTR-45 AC10: the places taken, against the lower of the registration capacity and the venue
  // places the VIPs leave (PTR-111).
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
          <div className="relative aspect-square overflow-hidden rounded-2xl cover-art shadow-card">
            <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
            <p
              aria-hidden="true"
              className="absolute bottom-0 left-0 p-5 display-h3 font-semibold text-white"
            >
              {details.name ?? "Event"}
            </p>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <EventRequestStatusBadge status={details.status} />
          </div>
          <h1 className="mt-3 font-semibold event-title">{details.name ?? "Event"}</h1>

          {date ? (
            <div className="mt-6 flex items-start gap-3">
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
            <p className="mt-6 font-semibold">Date to be confirmed</p>
          )}

          {/* Leave the venue row out for a cancelled event. Once its booking is released, the row
              would say that the venue is still to be confirmed. */}
          {isCancelled ? null : (
            <div className="mt-4 flex items-start gap-3">
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

          <Card className="mt-6">
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
              ) : period ? (
                <>
                  {period}
                  {/* VIPs can fill the venue after the normal places are taken, so a full event can
                      show more registrations than places. The reason takes the count's place. */}
                  {availability?.state === "full" ? null : places}
                  {availability?.state === "open" ? (
                    <RegisterAction eventId={details.id} eventName={details.name ?? "this event"} />
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
            <section aria-label="About Event" className="mt-6">
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
 * PTR-50 AC1–AC3: why the Attendee cannot register now, in place of the register action. The
 * server applies the same rule, so a stale page that still shows the action is refused with it.
 */
function RegistrationUnavailable({
  availability,
}: {
  availability: RegistrationAvailability | null | undefined;
}) {
  const sentence = "mt-4 body-sm font-semibold";
  switch (availability?.state) {
    // AC1: the period line above the sentence shows the opening date and time.
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
