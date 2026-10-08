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
import { withdrawFromEvent } from "#/features/events/server-fns";
import { NOT_REGISTERED_MESSAGE } from "#/features/events/withdrawal";
import { useMutation } from "#/hooks/use-mutation";

export function WithdrawAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, withdraw, withdrawing] = useMutation(async () => {
    try {
      await withdrawFromEvent({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      await router.invalidate();
      throw message === NOT_REGISTERED_MESSAGE ? error : new Error();
    }
    setOpen(false);
    toast.success(`You have withdrawn from ${eventName}.`);
    await router.invalidate();
  }, "Could not withdraw from this event. Try again.");

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <Button variant="outline" size="sm" disabled={withdrawing}>
              {withdrawing ? "Withdrawing…" : "Withdraw registration"}
            </Button>
          }
        />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw registration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to withdraw from {eventName}? Your place will be freed and given
              to someone else.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={withdrawing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              disabled={withdrawing}
              onClick={() => void withdraw()}
            >
              {withdrawing ? "Withdrawing…" : "Confirm withdrawal"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {open && state.status === "error" ? (
            <p role="alert" className="body-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
      {!open && state.status === "error" ? (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
