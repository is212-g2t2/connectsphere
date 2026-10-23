import { useState } from "react";
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
import { requestEventCancellation } from "#/features/event-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/** PTR-53 AC3: Where a request waits when the event has no Coordinator to notify. */
export const UNASSIGNED_CANCELLATION_NOTE =
  "No Coordinator is assigned yet, so the request waits in the unassigned events list.";

/**
 * PTR-53 AC4: The one sentence every cancellation surface uses. It names the assigned
 * Coordinator. It names any Coordinator while the event is unassigned (AC3).
 */
export function cancellationStatusNote(coordinatorName: string | null): string {
  return `The event's status stays the same until ${coordinatorName ?? "a Coordinator"} processes the request.`;
}

/**
 * PTR-53: The Organiser asks for cancellation of their event. The dialog names who decides. The
 * event stays as it is until then (AC3, AC4).
 */
export function RequestCancellationAction({
  requestId,
  coordinatorName,
}: {
  requestId: number;
  /** The assigned Coordinator's name, or null while the event is unassigned. */
  coordinatorName: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, requestCancellation, requesting] = useMutation(async () => {
    await requestEventCancellation({ data: { id: requestId } });
    setDialogOpen(false);
    toast.success(
      coordinatorName === null
        ? "Cancellation requested. It waits in the unassigned events list."
        : `Cancellation requested. ${coordinatorName} has been notified.`
    );

    // The request is recorded. A failed refresh must not report it as an error.
    try {
      await router.invalidate({ filter: skipRootFilter });
    } catch {
      toast.warning("Your cancellation request was saved. Refresh this page to see it.");
    }
  }, "Could not request cancellation. Try again.");

  const refusal =
    state.status === "error" ? (
      <p role={dialogOpen ? "alert" : undefined} className="body-sm text-destructive">
        {state.error}
      </p>
    ) : null;

  return (
    <div className="mt-5 flex flex-col items-start gap-2">
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={requesting} />}>
          Request cancellation
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Request cancellation</AlertDialogTitle>
            <AlertDialogDescription>
              {coordinatorName === null
                ? UNASSIGNED_CANCELLATION_NOTE
                : `${coordinatorName} is notified and decides whether to cancel the event.`}{" "}
              {cancellationStatusNote(coordinatorName)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={requesting}>
              Keep event
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              disabled={requesting}
              onClick={() => void requestCancellation()}
            >
              {requesting ? "Sending…" : "Send request"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {/* Show one copy at a time. Two live alert nodes would announce twice. */}
          {dialogOpen && refusal}
        </AlertDialogContent>
      </AlertDialog>
      {!dialogOpen && refusal}
    </div>
  );
}
