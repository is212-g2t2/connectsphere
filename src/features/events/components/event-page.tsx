import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDateTime } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { RegisterAction } from "#/features/events/components/register-action";
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

/** Whether `end` is the calendar day after `start` (`YYYY-MM-DD`), parsed as UTC so the
 * server render and the hydrated client agree. Anything not in that shape is not next-day. */
function isNextDay(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.exec(start) || !/^\d{4}-\d{2}-\d{2}$/.exec(end)) return false;
  const next = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return false;
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) === end;
}

/**
 * PTR-44: what an attendee sees of a confirmed event with registration on. Only the published
 * fields — name, description, date/time, the approved booking's venue, and the registration
 * period — so booking decisions, equipment, and clarification threads never reach this view.
 */
export function EventPage({ event }: { event: EventProjection }) {
  const { event: details } = event;
  // A confirmed event was published against its approved booking, not the original proposal —
  // the two can differ after a PTR-34 adjustment. Without a booking, fall back to the proposal.
  const date = details.venue?.date ?? details.eventDate;
  const endDate = details.venue?.endDate ?? details.endDate;
  const startTime = details.venue?.startTime ?? details.startTime;
  const endTime = details.venue?.endTime ?? details.endTime;
  const spansDays = Boolean(date && endDate && endDate !== date);
  const crossesMidnight = Boolean(
    details.venue && isNextDay(details.venue.date, details.venue.endDate)
  );
  const isRegistered = details.registration?.status === "registered";
  const hasTerms = Boolean(details.registrationOpensAt && details.registrationClosesAt);
  // PTR-45 AC10: the places taken, against the lower of the registration and venue capacity.
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

          <Card className="mt-6">
            <CardContent>
              <p className="label text-muted-foreground">Registration</p>
              {isRegistered ? (
                <>
                  <p className="mt-2 font-semibold">You&apos;re registered</p>
                  {hasTerms && details.registrationOpensAt && details.registrationClosesAt ? (
                    <p className="mt-1 body-sm text-muted-foreground">
                      Opens {formatLocalDateTime(details.registrationOpensAt)} – closes{" "}
                      {formatLocalDateTime(details.registrationClosesAt)}
                    </p>
                  ) : null}
                  {places}
                </>
              ) : hasTerms && details.registrationOpensAt && details.registrationClosesAt ? (
                <>
                  <p className="mt-2 body-sm text-muted-foreground">
                    Opens {formatLocalDateTime(details.registrationOpensAt)} – closes{" "}
                    {formatLocalDateTime(details.registrationClosesAt)}
                  </p>
                  {places}
                  <RegisterAction eventId={details.id} eventName={details.name ?? "this event"} />
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
