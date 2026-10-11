import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";
import {
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  isVenueConflictMessage,
} from "#/features/venue-requests/schema";
import { approveVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * Keep the alert when the server has already settled or deleted a request. It left the queue, so a
 * reload would return 404 and remove the alert, which may be the only trace.
 * A `Forbidden` request remains pending but another staff member claimed it. It stays in the shared
 * queue, so a reload adds no information.
 * `AuthorizationError` and `NotFoundError` use fixed text. Their classes do not cross the
 * server-function boundary for client-side `instanceof` checks.
 */
function requestIsGone(message: string): boolean {
  return (
    message === VENUE_REQUEST_DECIDED_MESSAGE ||
    message === VENUE_REQUEST_REJECTED_MESSAGE ||
    message === "Forbidden" ||
    message === "Not Found"
  );
}

/**
 * Check whether to show `message` verbatim. Show refusals for a settled request or a conflict with
 * an approved booking or active hold. Use the generic mutation message for other errors, such as
 * `Forbidden` or `Not Found`.
 */
function isApprovalConflict(message: string): boolean {
  return (
    message === VENUE_REQUEST_DECIDED_MESSAGE ||
    message === VENUE_REQUEST_REJECTED_MESSAGE ||
    isVenueConflictMessage(message)
  );
}

/**
 * PTR-33 criterion 1: Approve a pending request from its queue row or detail page.
 * On success, reload the queue because the detail route returns 404 after the request leaves
 * `pending`. Keep refusals beside the button. Reload only if the row still exists; an overlap
 * conflict leaves it pending, so the conflict badge can update.
 */
export function ApproveBookingButton({
  request,
  onDecided,
}: {
  request: Pick<PendingVenueRequest, "id" | "venueName" | "startsAt" | "endsAt" | "conflict">;
  /**
   * Where to go after a decision. The queue and old detail page return to the queue.
   * The event page stays open and reloads its data; the request leaves `pending` and its decision block disappears.
   */
  onDecided?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [state, approve, approving] = useMutation(async () => {
    try {
      await approveVenueRequest({ data: { id: request.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!requestIsGone(message)) await router.invalidate({ filter: skipRootFilter });
      throw isApprovalConflict(message) ? error : new Error();
    }
    toast.success(
      `Booking approved for ${request.venueName} from ${formatLocalDateTime(request.startsAt)}.`
    );
    if (onDecided) await onDecided();
    else await router.navigate({ to: "/dashboard" });
  }, "Could not approve this request. Try again.");

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              size="sm"
              variant={request.conflict ? "outline" : "default"}
              disabled={approving}
              aria-label={`Approve request for ${request.venueName}, ${formatLocalDateTime(request.startsAt)}`}
            />
          }
        >
          {approving ? "Approving…" : "Approve"}
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve request</AlertDialogTitle>
            <AlertDialogDescription>
              This approves the booking for {request.venueName} on{" "}
              {formatProposedWindow({ start: request.startsAt, end: request.endsAt })}. Approving
              books the venue for that period and notifies the requesting Coordinator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Escape closes the dialog during a request, so disabling Cancel would trap pointer users. */}
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" disabled={approving} onClick={() => void approve()}>
              {approving ? "Approving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {state.status === "error" && (
            <p role="alert" className="body-sm text-destructive">
              {state.error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
      {state.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
