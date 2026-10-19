import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { formatFirstProposedDate } from "#/features/event-requests/format";
import { deleteEventRequestDraft, reuseEventRequest } from "#/features/event-requests/server-fns";
import type {
  EventRequestDeleted,
  EventRequestDraft,
  EventRequestSummary,
} from "#/features/event-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";
import { skipRootFilter } from "#/lib/invalidate";

export const UNTITLED_REQUEST = "Untitled request";
/** The Coordinator column value while no assignment exists: a draft, or PTR-144's unassigned submission. */
export const NOT_YET_ASSIGNED = "Not yet assigned";

const DELETE_FAILED = "Could not delete this draft. Try again.";
const REUSE_FAILED = "Could not start a new draft from this request. Try again.";

/**
 * Show the Organiser's requests (PTR-14). The route passes loader rows as a prop, so unit tests can
 * render the table without a router (PTR-75).
 */
export function EventRequestListPage({ requests }: { requests: EventRequestSummary[] }) {
  const router = useRouter();
  const navigate = useNavigate();

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const [deleteState, deleteDraft, deleting] = useMutation<number, EventRequestDeleted>(
    id => deleteEventRequestDraft({ data: { id } }),
    DELETE_FAILED
  );

  const [reuseState, reuseRequest, reusing] = useMutation<number, EventRequestDraft>(
    id => reuseEventRequest({ data: { id } }),
    REUSE_FAILED
  );

  async function handleConfirmDelete(id: number) {
    const result = await deleteDraft(id);

    if (result.status === "success") {
      setPendingDeleteId(null);
      await router.invalidate({ filter: skipRootFilter });
    }
  }

  /** PTR-154: copy a past request into a new draft and open it for editing. */
  async function handleReuse(id: number) {
    const result = await reuseRequest(id);

    if (result.status === "success") {
      await navigate({
        to: "/event-requests/reopenDraft/$id",
        params: { id: String(result.data.id) },
      });
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
      {reuseState.status === "error" && (
        <p className="mt-4 body-sm text-destructive">{reuseState.error}</p>
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
                    {request.status === "draft" ? (
                      <Link
                        to="/event-requests/reopenDraft/$id"
                        params={{ id: String(request.id) }}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {request.eventName.trim() || UNTITLED_REQUEST}
                      </Link>
                    ) : (
                      <Link
                        to="/events/$eventId"
                        params={{ eventId: String(request.id) }}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {request.eventName.trim() || UNTITLED_REQUEST}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>{formatFirstProposedDate(request.proposedDates)}</TableCell>
                  <TableCell>
                    <EventRequestStatusBadge status={request.status} />
                  </TableCell>
                  {request.coordinator ? (
                    <TableCell>{request.coordinator.name}</TableCell>
                  ) : (
                    <TableCell>
                      <span className="text-muted-foreground">{NOT_YET_ASSIGNED}</span>
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
                    {request.status !== "draft" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={reusing}
                        onClick={() => void handleReuse(request.id)}
                      >
                        {reusing ? "Reusing…" : "Reuse"}
                      </Button>
                    )}
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
