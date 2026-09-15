import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { EventRequestSummary } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-14 criterion 3: a draft and a submitted request must be told apart without opening
 * either, so the pill differs in colour as well as in text. The variants are the design
 * system's status pills (docs/DESIGN.md#status-pills).
 */
const STATUS_VARIANT: Record<EventRequestStatus, "outline" | "progress"> = {
  draft: "outline",
  submitted: "progress",
};

export const UNTITLED_REQUEST = "Untitled request";
/**
 * Criterion 2 shows the assigned Coordinator "once one exists". Assignment arrives with PTR-15;
 * until its column lands every row reads the same way, and the copy is what changes then.
 */
export const NOT_YET_ASSIGNED = "Not yet assigned";

export function EventRequestStatusBadge({ status }: { status: EventRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{EVENT_REQUEST_STATUS_LABELS[status]}</Badge>;
}

/** The first proposed window's start, which is what "proposed date" means on a one-line row. */
function proposedDate(request: EventRequestSummary): string {
  const start = request.proposedDates.find(window => window.start !== undefined)?.start;
  return start === undefined ? "—" : formatLocalDateTime(start);
}

/**
 * The organiser's own requests (PTR-14). Rows come from the route's loader as a prop, so the
 * table renders in a unit test without a router (PTR-75).
 */
export function EventRequestListPage({ requests }: { requests: EventRequestSummary[] }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Event requests</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Every request you have started, and where each one stands.
          </p>
        </div>
        <Link
          to="/event-requests/new"
          className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New request
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No requests yet. Start one and save it as a draft whenever you like.
        </p>
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border font-mono text-xs tracking-widest text-muted-foreground uppercase">
              <tr>
                <th className="py-3 pr-4 font-medium">Event</th>
                <th className="py-3 pr-4 font-medium">Proposed date</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 font-medium">Coordinator</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(request => (
                <tr key={request.id} className="border-b border-border">
                  <td className="py-3 pr-4">
                    <Link
                      to="/event-requests/$requestId"
                      params={{ requestId: String(request.id) }}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {request.eventName.trim() || UNTITLED_REQUEST}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{proposedDate(request)}</td>
                  <td className="py-3 pr-4">
                    <EventRequestStatusBadge status={request.status} />
                  </td>
                  <td className="py-3 text-muted-foreground">{NOT_YET_ASSIGNED}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
