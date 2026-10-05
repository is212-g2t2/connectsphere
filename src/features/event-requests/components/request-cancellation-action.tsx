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

/**
 * PTR-53: the Organiser asks for their event to be cancelled. The dialog says plainly that the
 * event stays as it is until the Coordinator processes the request (AC4).
 */
export function RequestCancellationAction({ requestId }: { requestId: number }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, request, requesting] = useMutation(async () => {
    await requestEventCancellation({ data: { id: requestId } });
    setDialogOpen(false);
    toast.success("Cancellation requested. The Coordinator will process it.");
    await router.invalidate();
  }, "Could not request cancellation. Try again.");

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={requesting} />}>
          Request cancellation
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Request cancellation</AlertDialogTitle>
            <AlertDialogDescription>
              The Coordinator decides whether to cancel the event. Its status stays the same until
              then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={requesting}>
              Keep event
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              disabled={requesting}
              onClick={() => void request()}
            >
              {requesting ? "Sending…" : "Send request"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {state.status === "error" ? (
            <p role="alert" className="body-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
