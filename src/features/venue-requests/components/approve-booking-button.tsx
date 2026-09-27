import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { VENUE_REQUEST_DECIDED_MESSAGE } from "#/features/venue-requests/schema";
import { approveVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * A refusal that means the row will not be found again: settled by another decision, or claimed by
 * another staff member first — `AuthorizationError`/`NotFoundError`'s fixed text, since neither
 * survives the server-function boundary as a class the client can `instanceof`-check. Reloading for
 * one of these 404s the detail route and silently drops the row from the queue, taking the alert
 * with it, so the mutation skips the invalidate here and leaves the alert as the only trace.
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
  request: Pick<PendingVenueRequest, "id" | "venueName" | "startsAt" | "conflict">;
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
      <Button
        size="sm"
        variant={request.conflict ? "outline" : "default"}
        disabled={approving}
        aria-label={`Approve request for ${request.venueName}, ${formatLocalDateTime(request.startsAt)}`}
        onClick={() => void approve()}
      >
        {approving ? "Approving…" : "Approve"}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
