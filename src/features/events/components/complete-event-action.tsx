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
import { COMPLETION_REFUSAL_HEADING } from "#/features/events/completion";
import { completeEvent } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/** PTR-25: the assigned Coordinator explicitly closes an event after it ends. */
export function CompleteEventAction({
  eventId,
  eventName,
  disabledReason,
}: {
  eventId: number;
  eventName: string;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, complete, completing] = useMutation(async () => {
    try {
      await completeEvent({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      await router.invalidate();
      throw message.startsWith(COMPLETION_REFUSAL_HEADING) ? error : new Error();
    }
    toast.success("Event marked as completed.");
    await router.invalidate();
  }, "Could not complete this event. Try again.");

  const refusal =
    state.status === "error" ? (
      <p
        role={dialogOpen ? "alert" : undefined}
        className="body-sm whitespace-pre-line text-destructive"
      >
        {state.error}
      </p>
    ) : null;

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogTrigger
          render={
            <Button
              size="sm"
              disabled={completing || Boolean(disabledReason)}
              aria-label={`Complete event: ${eventName}`}
            />
          }
        >
          {completing ? "Completing…" : "Complete event"}
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Complete event</AlertDialogTitle>
            <AlertDialogDescription>
              Mark {eventName} as completed after its scheduled end time. This action does not run
              automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={completing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction size="sm" disabled={completing} onClick={() => void complete()}>
              {completing ? "Completing…" : "Mark completed"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {dialogOpen && refusal}
        </AlertDialogContent>
      </AlertDialog>
      {disabledReason && <p className="body-sm text-muted-foreground">{disabledReason}</p>}
      {!dialogOpen && refusal}
    </div>
  );
}
