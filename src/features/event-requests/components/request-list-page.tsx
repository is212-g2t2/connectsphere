import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
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
const STATUS_VARIANT: Record<EventRequestStatus, "outline" | "progress"> = {
  draft: "outline",
  submitted: "progress",
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
      {deleteState.status === "error" && (
        <p className="mt-4 text-sm text-destructive">{deleteState.error}</p>
      )}
      {requests.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No requests yet. Start one and save it as a draft whenever you like.
        </p>
      ) : (
        <div className="mt-10">
          <Table>
            <TableHeader className="border-b border-border font-mono text-xs tracking-widest text-muted-foreground uppercase">
              <TableRow>
                <TableHead className="py-3 pr-4 font-medium">Event</TableHead>
                <TableHead className="py-3 pr-4 font-medium">Proposed date</TableHead>
                <TableHead className="py-3 pr-4 font-medium">Status</TableHead>
                <TableHead className="py-3 font-medium">Coordinator</TableHead>
                <TableHead className="py-3 font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(request => (
                <TableRow key={request.id} className="border-b border-border">
                  <TableCell className="py-3 pr-4">
                    <Link
                      to="/event-requests/$requestId"
                      params={{ requestId: String(request.id) }}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {request.eventName.trim() || UNTITLED_REQUEST}
                    </Link>
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    {formatFirstProposedDate(request.proposedDates)}
                  </TableCell>
                  <TableCell className="py-3 pr-4">
                    <EventRequestStatusBadge status={request.status} />
                  </TableCell>
                  {request.coordinator ? (
                    <TableCell className="py-3">{request.coordinator.name}</TableCell>
                  ) : (
                    <TableCell className="py-3 text-muted-foreground">
                      {request.status === "draft" ? ASSIGNED_ON_SUBMIT : NOT_YET_ASSIGNED}
                    </TableCell>
                  )}
                  <TableCell className="py-3">
                    {request.status === "draft" &&
                      (pendingDeleteId === request.id ? (
                        <span className="flex items-center gap-2 text-sm">
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
    </main>
  );
}
