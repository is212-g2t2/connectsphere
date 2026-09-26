import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { approveVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * PTR-33 criterion 1: approve a pending request from its queue row or detail page. Success lands
 * on a reloaded queue, since the detail route 404s once the request leaves `pending`; a refusal
 * stays beside the button and reloads the loader, in case someone else decided the row.
 */
export function ApproveBookingButton({
  request,
}: {
  request: Pick<PendingVenueRequest, "id" | "venueName" | "startsAt">;
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
