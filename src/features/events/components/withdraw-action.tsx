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
import {
  isWithdrawalRefusal,
  PLACE_FREED_AT_CAPACITY_MESSAGE,
  PLACE_FREED_MESSAGE,
} from "#/features/events/withdrawal";
import { useMutation } from "#/hooks/use-mutation";

const GENERIC_WITHDRAW_FAILURE = "Could not withdraw from this event. Try again.";

export function WithdrawAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [state, withdraw, withdrawing] = useMutation(async () => {
    let placeFreedAtCapacity = false;
    try {
      placeFreedAtCapacity = await withdrawFromEvent({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      await router.invalidate();
      throw isWithdrawalRefusal(message) ? error : new Error(GENERIC_WITHDRAW_FAILURE);
    }
    setOpen(false);
    toast.success(placeFreedAtCapacity ? PLACE_FREED_AT_CAPACITY_MESSAGE : PLACE_FREED_MESSAGE);
    await router.invalidate();
  }, GENERIC_WITHDRAW_FAILURE);

  const refusal =
    state.status === "error" ? (
      <p role="alert" className="body-sm text-destructive">
        {state.error}
      </p>
    ) : null;

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
              Are you sure you want to withdraw from {eventName}? Your place will be freed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {open && refusal}
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
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
