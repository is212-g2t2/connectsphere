import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatLocalDate } from "#/features/event-requests/format";
import type { AttendeeRegistrationProjection } from "#/features/events/access";
import { isPublishedForAttendees } from "#/features/events/access";
import { eventSchedule } from "#/features/events/schedule";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The Attendee's registrations, projected from their own event records by the route loader.
 * Booking details take precedence over the original proposal so changes appear here.
 */
export function RegistrationListPage({
  registrations,
}: {
  registrations: AttendeeRegistrationProjection[];
}) {
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>
      <div className="mt-6">
        <PageHeader eyebrow="Attendee" title="My registrations" />
      </div>

      {registrations.length === 0 ? (
        <p className="mt-6 body-sm text-muted-foreground">You have no event registrations yet.</p>
      ) : (
        <ul aria-label="Event registrations" className="mt-6 grid gap-5 lg:grid-cols-2">
          {registrations.map(registration => {
            const { date, endDate, startTime, endTime, spansDays, crossesMidnight } =
              eventSchedule(registration);
            const registrationLabel =
              registration.registrationStatus === "registered" ? "Registered" : "Withdrawn";
            return (
              <li key={registration.eventId}>
                <Card>
                  <CardContent>
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="display-h3">
                        {isPublishedForAttendees({
                          status: registration.eventStatus,
                          registrationEnabled: registration.registrationEnabled,
                        }) ? (
                          <Link
                            to="/events/$eventId"
                            params={{ eventId: String(registration.eventId) }}
                            className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
                          >
                            {registration.eventName}
                          </Link>
                        ) : (
                          registration.eventName
                        )}
                      </h2>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <EventRequestStatusBadge status={registration.eventStatus} />
                        <Badge
                          variant="outline"
                          aria-label={`Your registration: ${registrationLabel}`}
                        >
                          {registrationLabel}
                        </Badge>
                      </div>
                    </div>

                    <dl className="mt-5 grid gap-4 body-sm sm:grid-cols-2">
                      <div>
                        <dt className="label text-muted-foreground">Date</dt>
                        <dd className="mt-1">
                          {!date
                            ? "Date to be confirmed"
                            : spansDays && endDate
                              ? `${formatLocalDate(date)} – ${formatLocalDate(endDate)}`
                              : formatLocalDate(date)}
                        </dd>
                      </div>
                      <div>
                        <dt className="label text-muted-foreground">Time</dt>
                        <dd className="mt-1">
                          {startTime && endTime
                            ? crossesMidnight
                              ? `${startTime} – ${endTime} (next day)`
                              : `${startTime}–${endTime}`
                            : "Time to be confirmed"}
                        </dd>
                      </div>
                      <div>
                        <dt className="label text-muted-foreground">Venue</dt>
                        <dd className="mt-1">
                          {registration.venue ? (
                            <>
                              <span className="block">{registration.venue.name}</span>
                              {registration.venue.location && (
                                <span className="block text-muted-foreground">
                                  {registration.venue.location}
                                </span>
                              )}
                            </>
                          ) : (
                            "Venue to be confirmed"
                          )}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
