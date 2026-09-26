import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { approveVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * PTR-33 criterion 1: Venue Staff approve a pending request from the queue row or its detail page.
 * Either way the request leaves `pending`, so both land on a reloaded queue: the detail route
 * would 404 on reload. A refusal (the overlap sentence PTR-36 names, or an already-decided row)
 * stays beside the button and the page stays where it is, but the loader reruns: another member
 * of staff may have decided the row, and the conflict flag may have moved.
 */
export function ApproveBookingButton({
  request,
}: {
  request: { id: string; venueName: string; startsAt: string };
}) {
  const router = useRouter();
  const [state, approve, approving] = useMutation(async () => {
    try {
      await approveVenueRequest({ data: { id: request.id } });
    } catch (error) {
      await router.invalidate();
      throw error;
    }
    toast.success(`Booking approved for ${request.venueName}.`);
    await router.navigate({ to: "/venue-requests" });
    await router.invalidate();
  }, "Could not approve this request. Try again.");

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        size="sm"
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
