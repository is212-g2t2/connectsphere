import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { acceptEventHandover, declineEventHandover } from "#/features/coordination/server-fns";
import type {
  AssignedEventRequest,
  PendingEventHandover,
} from "#/features/coordination/server-fns";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatFirstProposedDate, formatInstant } from "#/features/event-requests/format";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * Submitted requests the Coordinator can act on: their own assignments, the unassigned queue,
 * and (PTR-110) the handovers waiting on them to accept or decline. Rows arrive from the route's
 * loader; the detail repeats the ownership check on read.
 */
export function CoordinationPage({
  unassigned,
  assigned,
  handovers,
}: {
  unassigned: UnassignedEventRequest[];
  assigned: AssignedEventRequest[];
  handovers: PendingEventHandover[];
}) {
  const router = useRouter();

  const [answer, answerHandover, answering] = useMutation(
    async (input: { id: number; decision: "accepted" | "declined" }) => {
      if (input.decision === "accepted") {
        await acceptEventHandover({ data: { id: input.id } });
        toast.success("Handover accepted.");
      } else {
        await declineEventHandover({ data: { id: input.id } });
        toast.success("Handover declined.");
      }
      await router.invalidate();
    },
    "Could not answer this handover. Try again."
  );

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title="Coordination"
        description="Submitted requests are assigned to the least-loaded Coordinator as they arrive. Any that could not be assigned wait here for someone to pick up."
      />

      {handovers.length > 0 && (
        <section aria-labelledby="handovers-heading">
          <h2 id="handovers-heading" className="display-h2">
            Handovers awaiting your response
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            The event stays with its current Coordinator until you accept.
          </p>
          <ul className="mt-4 divide-y divide-border">
            {handovers.map(handover => (
              <li key={handover.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {handover.eventName.trim() || UNTITLED_REQUEST}
                  </span>
                  <EventRequestStatusBadge status={handover.status} />
                </div>
                <p className="mt-1 body-sm text-muted-foreground">
                  {handover.from?.name ?? "Another Coordinator"} offered this request to you on{" "}
                  {formatInstant(handover.requestedAt)}. Organiser: {handover.organiser.name}.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={answering}
                    onClick={() => void answerHandover({ id: handover.id, decision: "accepted" })}
                  >
                    Accept handover
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={answering}
                    onClick={() => void answerHandover({ id: handover.id, decision: "declined" })}
                  >
                    Decline handover
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {answer.status === "error" && (
            <p role="alert" className="mt-4 body-sm text-destructive">
              {answer.error}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="assigned-heading">
        <h2 id="assigned-heading" className="display-h2">
          Assigned to you
        </h2>
        <p className="mt-2 body-sm text-muted-foreground">
          Open a request to view it or hand it over to another Coordinator.
        </p>
        {assigned.length === 0 ? (
          <p className="mt-4 body-sm text-muted-foreground">No requests are assigned to you.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {assigned.map(request => (
              <li key={request.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/coordination/$requestId"
                    params={{ requestId: String(request.id) }}
                    className={NAV_LINK_CLASSNAME}
                  >
                    {request.eventName.trim() || UNTITLED_REQUEST}
                  </Link>
                  <EventRequestStatusBadge status={request.status} />
                </div>
                <p className="mt-1 body-sm text-muted-foreground">
                  {request.organiser.name}
                  {request.handoverTo ? ` — handover to ${request.handoverTo} pending` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="unassigned-heading">
        <h2 id="unassigned-heading" className="display-h2">
          Unassigned requests
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
                      <Link
                        to="/coordination/$requestId"
                        params={{ requestId: String(request.id) }}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {request.eventName.trim() || UNTITLED_REQUEST}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {request.organiser.name}
                      <br />
                      <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
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
    </Page>
  );
}
