import { Link } from "@tanstack/react-router";

import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { formatFirstProposedDate, formatInstant } from "#/features/event-requests/format";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const NO_REQUESTS: UnassignedEventRequest[] = [];

/**
 * Submitted requests the Coordinator can act on: their own assignments and the unassigned
 * queue. Rows arrive from the route's loader; the detail repeats the ownership check on read.
 */
export function CoordinationPage({
  unassigned,
  assigned = NO_REQUESTS,
}: {
  unassigned: UnassignedEventRequest[];
  assigned?: UnassignedEventRequest[];
}) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">Coordination</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Submitted requests are assigned to the least-loaded Coordinator as they arrive. Any that
        could not be assigned wait here for someone to pick up.
      </p>

      <section className="mt-10" aria-labelledby="assigned-heading">
        <h2 id="assigned-heading" className="text-lg font-semibold">
          Assigned to you
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a request to view it or hand it over to another Coordinator.
        </p>
        {assigned.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No requests are assigned to you.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {assigned.map(request => (
              <li key={request.id} className="py-3">
                <Link
                  to="/coordination/$requestId"
                  params={{ requestId: String(request.id) }}
                  className={NAV_LINK_CLASSNAME}
                >
                  {request.eventName.trim() || UNTITLED_REQUEST}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">{request.organiser.name}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="unassigned-heading">
        <h2 id="unassigned-heading" className="text-lg font-semibold">
          Unassigned requests
        </h2>

        {unassigned.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Every submitted request has a Coordinator.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border font-mono text-xs tracking-widest text-muted-foreground uppercase">
                <tr>
                  <th className="py-3 pr-4 font-medium">Event</th>
                  <th className="py-3 pr-4 font-medium">Organiser</th>
                  <th className="py-3 pr-4 font-medium">Proposed date</th>
                  <th className="py-3 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map(request => (
                  <tr key={request.id} className="border-b border-border">
                    <td className="py-3 pr-4 font-medium">
                      <Link
                        to="/coordination/$requestId"
                        params={{ requestId: String(request.id) }}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {request.eventName.trim() || UNTITLED_REQUEST}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">
                      {request.organiser.name}
                      <br />
                      <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
                        {request.organiser.email}
                      </a>
                    </td>
                    <td className="py-3 pr-4">{formatFirstProposedDate(request.proposedDates)}</td>
                    <td className="py-3">
                      <time dateTime={request.submittedAt?.toISOString()}>
                        {formatInstant(request.submittedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
