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
import { VENUE_REQUEST_DECIDED_MESSAGE } from "#/features/venue-requests/schema";
import { approveVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * Refusals that skip the reload, for opposite reasons. A request the client still shows as
 * `pending` but the server has already decided (or deleted) leaves the queue, so reloading would
 * 404 the detail route and silently drop the row, taking the alert with it — the alert stays as
 * the only trace. A "Forbidden" request is still `pending` but claimed by another staff member,
 * so it stays in the shared queue and a reload would just add nothing.
 * `AuthorizationError`/`NotFoundError` carry fixed text because neither survives the
 * server-function boundary as a class the client can `instanceof`-check.
 */
function requestIsGone(message: string): boolean {
  return (
    message === VENUE_REQUEST_DECIDED_MESSAGE || message === "Forbidden" || message === "Not Found"
  );
}

/**
 * Whether `message` is one of the two sentences worth showing verbatim: the request was already
 * decided, or the venue is already booked for an overlapping period (the named refusal or its
 * generic backstop). Anything else — a bare "Forbidden" or "Not Found" — is not this caller's to
 * explain, so it falls back to the mutation's generic text instead.
 */
function isApprovalConflict(message: string): boolean {
  return message === VENUE_REQUEST_DECIDED_MESSAGE || message.includes("is already booked");
}

/**
 * PTR-33 criterion 1: approve a pending request from its queue row or detail page. Success lands
 * on a reloaded queue, since the detail route 404s once the request leaves `pending`; a refusal
 * stays beside the button, and only reloads the loader when the row can still be found there —
 * an overlap conflict leaves it pending, so reloading still lets the "Conflicting booking" badge
 * catch up.
 */
export function ApproveBookingButton({
  request,
}: {
  request: Pick<PendingVenueRequest, "id" | "venueName" | "startsAt" | "endsAt" | "conflict">;
}) {
  const router = useRouter();
  const [state, approve, approving] = useMutation(async () => {
    try {
      await approveVenueRequest({ data: { id: request.id } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!requestIsGone(message)) await router.invalidate();
      throw isApprovalConflict(message) ? error : new Error();
    }
    toast.success(
      `Booking approved for ${request.venueName} from ${formatLocalDateTime(request.startsAt)}.`
    );
    await router.navigate({ to: "/venue-requests" });
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
              holds the venue for that period and notifies the requesting Coordinator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Escape already closes mid-flight, so disabling Cancel would only trap pointer users. */}
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
