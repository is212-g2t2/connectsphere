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
import { CONFIRMATION_REFUSAL_HEADING } from "#/features/events/confirmation";
import { confirmEvent } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * PTR-24 AC1/AC2: the assigned Coordinator confirms the event. The action stays available while
 * arrangements are outstanding on purpose: the refusal names every outstanding item, which is
 * more use than a disabled button that cannot say why. Only the server's named refusal is shown
 * verbatim; any other failure falls back to the generic text.
 */
export function ConfirmEventAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  const router = useRouter();
  const [state, confirm, confirming] = useMutation(async () => {
    try {
      await confirmEvent({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // The arrangements the refusal names may have moved since this page loaded.
      await router.invalidate();
      throw message.startsWith(CONFIRMATION_REFUSAL_HEADING) ? error : new Error();
    }
    toast.success("Event confirmed. The Organiser has been notified.");
    await router.invalidate();
  }, "Could not confirm this event. Try again.");

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button size="sm" disabled={confirming} aria-label={`Confirm ${eventName}`} />}
        >
          {confirming ? "Confirming…" : "Confirm event"}
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm event</AlertDialogTitle>
            <AlertDialogDescription>
              This confirms {eventName} with its approved venue booking and equipment arrangements,
              and notifies the Organiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" disabled={confirming} onClick={() => void confirm()}>
              {confirming ? "Confirming…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {/* The dialog stays open on a refusal and its modal hides the copy beside the button. */}
          {state.status === "error" && (
            <p role="alert" className="body-sm whitespace-pre-line text-destructive">
              {state.error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
      {state.status === "error" && (
        <p role="alert" className="body-sm whitespace-pre-line text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
