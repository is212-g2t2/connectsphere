import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type {
  AssignedEventRequest,
  CoordinatorOversight,
} from "#/features/coordination/server-fns";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatFirstProposedDate, formatInstant } from "#/features/event-requests/format";
import { isActiveEventRequest } from "#/features/event-requests/schema";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** Count active events once per Coordinator, so the ranking and the badge agree. */
function activeEventCount(coordinator: CoordinatorOversight): number {
  return coordinator.events.filter(event => isActiveEventRequest(event.status)).length;
}

/** Rank the busiest Coordinators first; break ties by name. */
function rankByWorkload(oversight: CoordinatorOversight[]): CoordinatorOversight[] {
  return oversight.toSorted(
    (a, b) => activeEventCount(b) - activeEventCount(a) || a.name.localeCompare(b.name)
  );
}

/**
 * Whole days since submission, for the queue's submitted-age column. The unit test pins the
 * boundaries; the table shows it beside the absolute time. The page passes `now` from its loader
 * so server markup and the first client render agree.
 */
export function submittedAge(submittedAt: Date | null, now: Date): string {
  if (submittedAt === null) return "—";
  const days = Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 86_400_000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** The flags that stay beside a row title: blocks and waiting change or cancellation requests. */
function RowFlags({ request }: { request: AssignedEventRequest | UnassignedEventRequest }) {
  return (
    <>
      {"venueBlocked" in request && request.venueBlocked ? (
        <Badge variant="stopped">Venue blocked</Badge>
      ) : null}
      {request.changeRequestsWaiting > 0 ? (
        <Badge variant="secondary">
          {request.changeRequestsWaiting === 1
            ? "1 change request waiting"
            : `${request.changeRequestsWaiting} change requests waiting`}
        </Badge>
      ) : null}
      {"cancellationRequested" in request && request.cancellationRequested ? (
        <Badge variant="stopped">Cancellation requested</Badge>
      ) : null}
    </>
  );
}

/**
 * The coordination queue. A Coordinator sees their own assignments. The Event Coordinator Lead
 * sees the unassigned requests instead: submissions wait for allocation (PTR-144), and the
 * Lead opens a row to assign a Coordinator there (PTR-145). PTR-149 adds every Coordinator's
 * workload below the queue. Rows arrive from the route's loader; the detail repeats the
 * ownership check on read. PTR-145 retires the handover, so no transfer action appears anywhere.
 *
 * Each queue row carries one link: the row title. The Coordinator's rows are whole-row links;
 * the Lead's table keeps the title as the row's only link and prints the organiser contact as
 * text, so no nested action breaks the row. Rows arrive from the route's loader.
 */
export function CoordinationPage({
  view,
  unassigned,
  assigned,
  oversight,
  now,
}: {
  view: "lead" | "coordinator";
  unassigned: UnassignedEventRequest[];
  assigned: AssignedEventRequest[];
  oversight: CoordinatorOversight[];
  /** The loader's time, so the submitted age renders the same on the server and the client. */
  now: Date;
}) {
  const queueCount = view === "lead" ? unassigned.length : assigned.length;
  return (
    <Page width="wide">
      <PageHeader
        back={
          <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
            Back to dashboard
          </Link>
        }
        title={`Coordination (${queueCount})`}
        description={
          view === "lead"
            ? "Assign each submitted request a Coordinator, and balance each Coordinator's load below."
            : "The requests assigned to you."
        }
      />

      {view === "coordinator" && (
        <section aria-labelledby="assigned-heading">
          <h2 id="assigned-heading" className="display-h3">
            Assigned to you
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            Open a request to view it or work on it.
          </p>
          {assigned.length === 0 ? (
            <>
              <p className="mt-4 body-sm text-muted-foreground">No requests are assigned to you.</p>
              <p className="mt-2 body-sm">
                <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
                  Back to dashboard
                </Link>
              </p>
            </>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {assigned.map(request => (
                <li key={request.id}>
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: String(request.id) }}
                    className="block py-3"
                  >
                    <span className="flex items-start justify-between gap-4">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {request.eventName.trim() || UNTITLED_REQUEST}
                          <RowFlags request={request} />
                        </span>
                        <span className="mt-1 block body-sm text-muted-foreground">
                          {request.organiser.name} ·{" "}
                          {formatFirstProposedDate(request.proposedDates)} · Submitted{" "}
                          {submittedAge(request.submittedAt, now)}
                        </span>
                      </span>
                      <EventRequestStatusBadge status={request.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view === "lead" && (
        <section aria-labelledby="unassigned-heading">
          <h2 id="unassigned-heading" className="display-h3">
            Unassigned requests
          </h2>

          {unassigned.length === 0 ? (
            <>
              <p className="mt-4 body-sm text-muted-foreground">
                Every submitted request has a Coordinator.
              </p>
              <p className="mt-2 body-sm">
                <a href="#oversight" className={NAV_LINK_CLASSNAME}>
                  Review coordinator workloads
                </a>
              </p>
            </>
          ) : (
            <>
              {/* Below sm the five-column table clips, so the queue renders as list rows with
                the event and its status. The table keeps the full columns from sm up. */}
              <ul
                className="mt-4 divide-y divide-border sm:hidden"
                aria-label="Unassigned requests"
              >
                {unassigned.map(request => (
                  <li key={request.id} className="py-3">
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: String(request.id) }}
                      className="flex items-start justify-between gap-4"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="underline underline-offset-4">
                            {request.eventName.trim() || UNTITLED_REQUEST}
                          </span>
                          <RowFlags request={request} />
                        </span>
                        <span className="mt-1 block body-sm text-muted-foreground">
                          {request.organiser.name} ·{" "}
                          <span className="break-all">{request.organiser.email}</span> ·{" "}
                          {formatFirstProposedDate(request.proposedDates)} · Submitted{" "}
                          {submittedAge(request.submittedAt, now)}
                        </span>
                      </span>
                      <EventRequestStatusBadge status={request.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4 hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Organiser</TableHead>
                      <TableHead>Proposed date</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unassigned.map(request => (
                      <TableRow key={request.id}>
                        <TableCell className="whitespace-normal">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to="/events/$eventId"
                              params={{ eventId: String(request.id) }}
                              className={`${NAV_LINK_CLASSNAME} break-words`}
                            >
                              {request.eventName.trim() || UNTITLED_REQUEST}
                            </Link>
                            <RowFlags request={request} />
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {request.organiser.name}
                          <br />
                          <span className="body-sm break-all text-muted-foreground">
                            {request.organiser.email}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {formatFirstProposedDate(request.proposedDates)}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <time dateTime={request.submittedAt?.toISOString()}>
                            {formatInstant(request.submittedAt)}
                          </time>{" "}
                          <span className="body-sm text-muted-foreground">
                            ({submittedAge(request.submittedAt, now)})
                          </span>
                        </TableCell>
                        <TableCell>
                          <EventRequestStatusBadge status={request.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </section>
      )}

      {view === "lead" && (
        <section aria-labelledby="oversight-heading" id="oversight" className="mt-10">
          <h2 id="oversight-heading" className="display-h3">
            Coordinator oversight
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            Busiest first. Open an event to reassign it.
          </p>

          {oversight.length === 0 ? (
            <p className="mt-4 body-sm text-muted-foreground">
              No Event Coordinators are registered.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {rankByWorkload(oversight).map(coordinator => {
                const active = coordinator.events.filter(event =>
                  isActiveEventRequest(event.status)
                );
                const closed = coordinator.events.filter(
                  event => !isActiveEventRequest(event.status)
                );
                const closedLabel =
                  closed.length === 1 ? "1 closed event" : `${closed.length} closed events`;
                return (
                  <li key={coordinator.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="display-h3">{coordinator.name}</h3>
                      <a href={`mailto:${coordinator.email}`} className={NAV_LINK_CLASSNAME}>
                        {coordinator.email}
                      </a>
                      {coordinator.events.length > 0 ? (
                        <Badge variant="secondary">
                          {active.length === 1
                            ? "1 active event"
                            : `${active.length} active events`}
                        </Badge>
                      ) : null}
                    </div>

                    {coordinator.events.length === 0 ? (
                      <p className="mt-2 body-sm text-muted-foreground">
                        No events are assigned to this Coordinator.
                      </p>
                    ) : (
                      <>
                        {active.length > 0 ? (
                          <>
                            <h4 className="mt-3 eyebrow text-muted-foreground">Active events</h4>
                            <OversightEventList
                              label={`${coordinator.name} active events`}
                              events={active}
                            />
                          </>
                        ) : null}
                        {closed.length > 0 ? (
                          <>
                            <h4 className="mt-3 eyebrow text-muted-foreground">Closed</h4>
                            <details className="mt-2">
                              <summary className="w-fit cursor-pointer body-sm text-muted-foreground">
                                {closedLabel}
                              </summary>
                              <OversightEventList
                                label={`${coordinator.name} closed events`}
                                events={closed}
                              />
                            </details>
                          </>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Page>
  );
}

/** One Coordinator's events, each opening the read-only Lead view of the event. */
function OversightEventList({
  label,
  events,
}: {
  label: string;
  events: CoordinatorOversight["events"];
}) {
  return (
    <ul aria-label={label} className="mt-2 space-y-2">
      {events.map(event => (
        <li
          key={event.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-baseline"
        >
          <Link
            to="/events/$eventId"
            params={{ eventId: String(event.id) }}
            className={NAV_LINK_CLASSNAME}
          >
            {event.eventName.trim() || UNTITLED_REQUEST}
          </Link>
          <EventRequestStatusBadge status={event.status} />
          {event.assignedAt ? (
            <span className="body-sm text-muted-foreground">
              Assigned{" "}
              <time dateTime={event.assignedAt.toISOString()}>
                {formatInstant(event.assignedAt)}
              </time>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
