import type { ReactNode } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { ReleaseEquipmentAction } from "#/features/equipment-requests/components/release-equipment-action";
import { LastReleaseNote } from "#/features/equipment-requests/components/last-release-note";
import { ReserveEquipmentAction } from "#/features/equipment-requests/components/reserve-equipment-action";
import { ReservedCount } from "#/features/equipment-requests/components/reserved-count";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import type {
  EquipmentLineProjection,
  EventProjection,
  VenueRequestRejection,
} from "#/features/events/access";
import { isConfirmableStatus } from "#/features/events/confirmation";
import { ConfirmEventAction } from "#/features/events/components/confirm-event-action";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { EquipmentPanel } from "#/features/equipment-requests/components/equipment-panel";
import { arrangementStateLabel, canGiveBackUnits } from "#/features/equipment-requests/schema";
import { SEARCHABLE_EVENT_STATUSES } from "#/features/venues/schema";
import { formatVenueSuggestion } from "#/features/venue-requests/schema";

// Rebuilding an `Intl.DateTimeFormat` per call is wasted work on a list of cards; one instance is
// reused for every date this component formats.
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00`));
}

/**
 * The dashboard's "Your connected events" widget. Its data arrives from the dashboard loader,
 * which calls the `listEvents` server function, so this view renders what the caller is allowed
 * to see rather than fetching anything itself.
 */
export function EventWorkspace({ events }: { events: EventProjection[] }) {
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="event-workspace-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-muted-foreground">Workspace</p>
          <h2 id="event-workspace-title" className="mt-2 display-h3">
            Your connected events
          </h2>
        </div>
        {events[0] && (
          <span className="body-sm text-muted-foreground">
            Access filtered by your relationship
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-6 body-sm text-muted-foreground">
          No events are currently connected to your account.
        </p>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {events.map(({ access, event }) => (
            <Card key={event.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow text-muted-foreground">
                      {access.replaceAll("_", " ")} access
                    </p>
                    <h3 className="mt-2 display-h3">{event.name ?? "Venue request"}</h3>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <EventRequestStatusBadge status={event.status} />
                    {event.registration?.status && (
                      <Badge variant="confirmed">{event.registration.status}</Badge>
                    )}
                  </div>
                </div>

                {event.description && (
                  <p className="mt-4 body-sm text-muted-foreground">{event.description}</p>
                )}
                <div className="mt-5 grid gap-3 body-sm text-muted-foreground sm:grid-cols-2">
                  {event.eventDate && (
                    <span className="flex items-center gap-2">
                      <CalendarDays className="size-4" />
                      {formatDate(event.eventDate)}
                    </span>
                  )}
                  {event.startTime && event.endTime && (
                    <span className="flex items-center gap-2">
                      <Clock3 className="size-4" />
                      {event.startTime}–{event.endTime}
                    </span>
                  )}
                </div>

                {(access === "venue_staff" ||
                  access === "organiser" ||
                  access === "coordinator") && (
                  <EventRequirements
                    event={event}
                    className="mt-5 border-t border-border pt-4 body-sm"
                  >
                    {event.venueRequest && (
                      <>
                        <Detail
                          label="Venue request"
                          value={
                            <span className="flex flex-wrap items-center gap-2">
                              {event.venueRequest.status === "rejected" ? (
                                <Badge variant="stopped">Rejected</Badge>
                              ) : event.venueRequest.status === "released" ? (
                                <Badge variant="stopped">Released</Badge>
                              ) : (
                                <Badge variant="progress">Pending</Badge>
                              )}
                              {event.venueRequest.conflict && (
                                <Badge variant="stopped">
                                  {event.venueRequest.conflict === "hold"
                                    ? "Conflicting hold"
                                    : "Conflicting booking"}
                                </Badge>
                              )}
                            </span>
                          }
                        />
                        {event.venueRequest.rejection && (
                          <>
                            <Detail
                              label={
                                event.venueRequest.status === "rejected"
                                  ? "Rejected booking"
                                  : "Previously rejected booking"
                              }
                              value={`${event.venueRequest.rejection.venueName}, ${formatDate(
                                event.venueRequest.rejection.date
                              )}, ${event.venueRequest.rejection.startTime}–${
                                event.venueRequest.rejection.endTime
                              }`}
                            />
                            <Detail
                              label="Rejection reason"
                              value={
                                <span className="whitespace-pre-line">
                                  {event.venueRequest.rejection.reason}
                                </span>
                              }
                            />
                            {event.venueRequest.rejection.suggestion && (
                              <Detail
                                label="Suggested alternative"
                                value={formatVenueSuggestion(
                                  event.venueRequest.rejection.suggestion,
                                  formatDate
                                )}
                              />
                            )}
                            {access === "coordinator" &&
                              event.venueRequest.status === "rejected" &&
                              event.status === "submitted" && (
                                <AdjustRequestRow
                                  eventId={event.id}
                                  rejection={event.venueRequest.rejection}
                                />
                              )}
                          </>
                        )}
                        {event.venueRequest.release && (
                          <>
                            <Detail
                              label="Released booking"
                              value={`${event.venueRequest.release.venueName}, ${formatDate(
                                event.venueRequest.release.date
                              )}, ${event.venueRequest.release.startTime}–${
                                event.venueRequest.release.endTime
                              }`}
                            />
                            <Detail
                              label="Release reason"
                              value={
                                <span className="whitespace-pre-line">
                                  {event.venueRequest.release.reason}
                                </span>
                              }
                            />
                            {event.venueRequest.release.changedByName && (
                              <Detail
                                label="Released by"
                                value={event.venueRequest.release.changedByName}
                              />
                            )}
                          </>
                        )}
                      </>
                    )}
                  </EventRequirements>
                )}

                {/* PTR-24 AC3: the confirmed venue, date and time, and who confirmed it, for the two roles that see the full record. */}
                {event.confirmation && (
                  <dl
                    className="mt-5 space-y-3 border-t border-border pt-4 body-sm"
                    aria-label="Confirmation"
                  >
                    {event.confirmation.venue ? (
                      <>
                        <Detail label="Confirmed venue" value={event.confirmation.venue.name} />
                        <Detail
                          label="Confirmed date and time"
                          value={`${formatDate(event.confirmation.venue.date)}, ${
                            event.confirmation.venue.startTime
                          }–${event.confirmation.venue.endTime}`}
                        />
                      </>
                    ) : (
                      <Detail
                        label="Venue booking"
                        value="The booking has been released. The Coordinator will follow up."
                      />
                    )}
                    <Detail
                      label="Confirmed"
                      value={`${dateTimeFormatter.format(new Date(event.confirmation.confirmedAt))} by ${
                        event.confirmation.confirmedByName
                      }`}
                    />
                  </dl>
                )}

                {/* PTR-38: coordinator gets the editable panel; technical_support and organiser keep the read-only list. */}
                {access === "coordinator" && event.equipment !== undefined && (
                  <div className="mt-5 border-t border-border pt-4">
                    <EquipmentPanel
                      eventId={event.id}
                      lines={event.equipment}
                      status={event.status}
                      submittedAt={event.equipmentSubmittedAt ?? null}
                      arrangementsCompletedAt={event.equipmentArrangementsCompletedAt ?? null}
                    />
                  </div>
                )}

                {access === "coordinator" && isConfirmableStatus(event.status) && (
                  <div className="mt-5 border-t border-border pt-4">
                    <ConfirmEventAction eventId={event.id} eventName={event.name ?? "this event"} />
                  </div>
                )}

                {(access === "technical_support" || access === "organiser") &&
                  event.equipment &&
                  event.equipment.length > 0 && (
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="body-sm font-medium">Equipment arrangements</p>
                      <ul className="mt-3 space-y-3">
                        {event.equipment.map(item => (
                          <EquipmentItemRow
                            key={item.id}
                            item={item}
                            canReserve={
                              access === "technical_support" &&
                              item.arrangeable === true &&
                              (item.arrangementStatus === "requested" ||
                                item.arrangementStatus === "reserved")
                            }
                            canRelease={access === "technical_support" && canGiveBackUnits(item)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}

                {access === "coordinator" && SEARCHABLE_EVENT_STATUSES.includes(event.status) && (
                  <div className="mt-5 border-t border-border pt-4">
                    <Link
                      to="/venues"
                      search={{ eventId: event.id }}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Find venues for this event
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * What an adjusted request opens with: the suggested venue when Venue Staff named one, else the
 * venue that refused, and each part of the window falling back the same way, so a suggestion of
 * "same room, a day later" needs nothing retyped. Times are taken only as a pair.
 */
function adjustedRequest(rejection: VenueRequestRejection): {
  venueId: number;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
} {
  const suggestion = rejection.suggestion;
  const times =
    suggestion?.startTime && suggestion.endTime
      ? { startTime: suggestion.startTime, endTime: suggestion.endTime }
      : { startTime: rejection.startTime, endTime: rejection.endTime };
  return {
    venueId: rejection.suggestedVenueId ?? rejection.venueId,
    venueName: suggestion?.venueName ?? rejection.venueName,
    date: suggestion?.date ?? rejection.date,
    ...times,
  };
}

/**
 * The rejection block's action: reopen the request on the suggested venue with its window. Only
 * while the event is still `submitted`, the one status the venue page's request panel answers
 * for, and only for the Coordinator — the caller gates both.
 */
function AdjustRequestRow({
  eventId,
  rejection,
}: {
  eventId: number;
  rejection: VenueRequestRejection;
}) {
  const { venueId, venueName, ...window } = adjustedRequest(rejection);
  return (
    <Detail
      label="Next step"
      value={
        <Link
          to="/venues/$venueId"
          params={{ venueId: String(venueId) }}
          search={{ eventId, ...window }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Adjust request at {venueName}
        </Link>
      }
    />
  );
}

/** The one extra row a card adds beside the shared requirements: its pending request. */
function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function EquipmentItemRow({
  item,
  canReserve,
  canRelease,
}: {
  item: EquipmentLineProjection;
  canReserve: boolean;
  /** Shared with the review page via `canGiveBackUnits`: units held, and this member may arrange. */
  canRelease: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 body-sm">
      <div>
        <span className="font-medium">{item.item}</span>
        <span className="text-muted-foreground"> × {item.quantity}</span>
        {typeof item.reservedQuantity === "number" && (
          <ReservedCount quantity={item.reservedQuantity} className="text-muted-foreground" />
        )}
        {item.notes && <p className="mt-0.5 text-muted-foreground">{item.notes}</p>}
        {item.lastRelease && <LastReleaseNote release={item.lastRelease} />}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span>{arrangementStateLabel(item.arrangementStatus)}</span>
        {canReserve && <ReserveEquipmentAction line={item} />}
        {canRelease && <ReleaseEquipmentAction line={item} />}
      </div>
    </li>
  );
}
