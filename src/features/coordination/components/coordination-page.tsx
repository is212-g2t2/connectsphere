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
import type { AssignedEventRequest } from "#/features/coordination/server-fns";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatFirstProposedDate, formatInstant } from "#/features/event-requests/format";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The coordination queue. A Coordinator sees their own assignments. The Event Coordinator Lead
 * sees the unassigned requests instead: submissions wait for allocation (PTR-144), and the Lead
 * opens a row to assign a Coordinator there (PTR-145). Rows arrive from the route's loader; the
 * detail repeats the ownership check on read. PTR-145 retires the handover, so no transfer action
 * appears anywhere.
 */
export function CoordinationPage({
  view,
  unassigned,
  assigned,
}: {
  view: "lead" | "coordinator";
  unassigned: UnassignedEventRequest[];
  assigned: AssignedEventRequest[];
}) {
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title={view === "lead" ? "Unassigned requests" : "Coordination"}
        description={
          view === "lead"
            ? "Submitted requests that no Coordinator holds yet. Open one to assign it."
            : "The requests assigned to you."
        }
      />

      {view === "coordinator" && (
        <section aria-labelledby="assigned-heading">
          <h2 id="assigned-heading" className="display-h2">
            Assigned to you
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            Open a request to view it or work on it.
          </p>
          {assigned.length === 0 ? (
            <p className="mt-4 body-sm text-muted-foreground">No requests are assigned to you.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {assigned.map(request => (
                <li key={request.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/events/$eventId"
                      params={{ eventId: String(request.id) }}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {request.eventName.trim() || UNTITLED_REQUEST}
                    </Link>
                    <EventRequestStatusBadge status={request.status} />
                    {request.venueBlocked ? <Badge variant="stopped">Venue blocked</Badge> : null}
                    {request.changeRequestsWaiting > 0 ? (
                      <Badge variant="secondary">
                        {request.changeRequestsWaiting === 1
                          ? "1 change request waiting"
                          : `${request.changeRequestsWaiting} change requests waiting`}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 body-sm text-muted-foreground">{request.organiser.name}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view === "lead" && (
        <section aria-labelledby="unassigned-heading">
          <h2 id="unassigned-heading" className="display-h2">
            Waiting for a Coordinator
          </h2>

          {unassigned.length === 0 ? (
            <p className="mt-4 body-sm text-muted-foreground">
              Every submitted request has a Coordinator.
            </p>
          ) : (
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Organiser</TableHead>
                    <TableHead>Proposed date</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassigned.map(request => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to="/events/$eventId"
                            params={{ eventId: String(request.id) }}
                            className={NAV_LINK_CLASSNAME}
                          >
                            {request.eventName.trim() || UNTITLED_REQUEST}
                          </Link>
                          {request.cancellationRequested ? (
                            <Badge variant="stopped">Cancellation requested</Badge>
                          ) : null}
                          {request.changeRequestsWaiting > 0 ? (
                            <Badge variant="secondary">
                              {request.changeRequestsWaiting === 1
                                ? "1 change request waiting"
                                : `${request.changeRequestsWaiting} change requests waiting`}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {request.organiser.name}
                        <br />
                        <a
                          href={`mailto:${request.organiser.email}`}
                          className={NAV_LINK_CLASSNAME}
                        >
                          {request.organiser.email}
                        </a>
                      </TableCell>
                      <TableCell>{formatFirstProposedDate(request.proposedDates)}</TableCell>
                      <TableCell>
                        <time dateTime={request.submittedAt?.toISOString()}>
                          {formatInstant(request.submittedAt)}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
