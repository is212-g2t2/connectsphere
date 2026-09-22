import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { unwrapRefusal } from "#/features/auth/session";
import { formatFirstProposedDate } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { deleteEventRequestDraft } from "#/features/event-requests/server-fns";
import type {
  EventRequestDeleted,
  EventRequestSummary,
} from "#/features/event-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-14 criterion 3: a draft and a submitted request must be told apart without opening
 * either, so the pill differs in colour as well as in text. The variants are the design
 * system's status pills (docs/DESIGN.md#status-pills).
 */
const STATUS_VARIANT: Record<EventRequestStatus, "outline" | "progress" | "confirmed" | "stopped"> =
  {
    draft: "outline",
    submitted: "progress",
    under_review: "progress",
    approved: "confirmed",
    rejected: "stopped",
    awaiting_organiser: "stopped",
  };

export const UNTITLED_REQUEST = "Untitled request";
/** What criterion 2's Coordinator column reads on a submitted request nobody could be assigned to. */
export const NOT_YET_ASSIGNED = "Not yet assigned";
/** And on a draft, which PTR-15 only assigns at submission. */
export const ASSIGNED_ON_SUBMIT = "Assigned when you submit";

const DELETE_FAILED = "Could not delete this draft. Try again.";

export function EventRequestStatusBadge({ status }: { status: EventRequestStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{EVENT_REQUEST_STATUS_LABELS[status]}</Badge>;
}

/**
 * The organiser's own requests (PTR-14). Rows come from the route's loader as a prop, so the
 * table renders in a unit test without a router (PTR-75).
 */
export function EventRequestListPage({ requests }: { requests: EventRequestSummary[] }) {
  const router = useRouter();

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const [deleteState, deleteDraft, deleting] = useMutation<number, EventRequestDeleted>(
    async id => unwrapRefusal(await deleteEventRequestDraft({ data: { id } }), DELETE_FAILED),
    DELETE_FAILED
  );

  async function handleConfirmDelete(id: number) {
    const result = await deleteDraft(id);

    if (result.status === "success") {
      setPendingDeleteId(null);
      await router.invalidate();
    }
  }
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title="Event requests"
        description="Every request you have started, and where each one stands."
        actions={
          <Link to="/event-requests/new" className={buttonVariants()}>
            New request
          </Link>
        }
      />
      {deleteState.status === "error" && (
        <p className="mt-4 body-sm text-destructive">{deleteState.error}</p>
      )}
      {requests.length === 0 ? (
        <p className="mt-10 body-sm text-muted-foreground">
          No requests yet. Start one and save it as a draft whenever you like.
        </p>
      ) : (
        <div className="mt-10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Proposed date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Coordinator</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(request => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link
                      to="/event-requests/$requestId"
                      params={{ requestId: String(request.id) }}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {request.eventName.trim() || UNTITLED_REQUEST}
                    </Link>
                  </TableCell>
                  <TableCell>{formatFirstProposedDate(request.proposedDates)}</TableCell>
                  <TableCell>
                    <EventRequestStatusBadge status={request.status} />
                  </TableCell>
                  {request.coordinator ? (
                    <TableCell>{request.coordinator.name}</TableCell>
                  ) : (
                    <TableCell>
                      <span className="text-muted-foreground">
                        {request.status === "draft" ? ASSIGNED_ON_SUBMIT : NOT_YET_ASSIGNED}
                      </span>
                    </TableCell>
                  )}
                  <TableCell>
                    {request.status === "draft" &&
                      (pendingDeleteId === request.id ? (
                        <span className="flex items-center gap-2 body-sm">
                          Delete this draft?
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deleting}
                            onClick={() => void handleConfirmDelete(request.id)}
                          >
                            {deleting ? "Deleting…" : "Confirm"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deleting}
                            onClick={() => setPendingDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Link
                            to="/event-requests/reopenDraft/$id"
                            params={{ id: String(request.id) }}
                            className={NAV_LINK_CLASSNAME}
                          >
                            Resume
                          </Link>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingDeleteId(request.id)}
                          >
                            Delete
                          </Button>
                        </span>
                      ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Page>
  );
}
