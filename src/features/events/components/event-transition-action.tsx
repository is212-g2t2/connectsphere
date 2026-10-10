import { useId, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Info } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip";
import { useMutation } from "#/hooks/use-mutation";

interface EventTransitionActionProps {
  eventName: string;
  disabledReason?: string | null;
  run: () => Promise<unknown>;
  triggerLabel: string;
  pendingLabel: string;
  dialogTitle: string;
  dialogDescription: ReactNode;
  actionLabel: string;
  successMessage: string;
  failureMessage: string;
  refusalHeading: string;
  /** Refetch on a named refusal too. The confirm path names arrangements that may have moved. */
  invalidateOnRefusal?: boolean;
}

/** One confirm/complete dialog. A refusal rethrows the server text; any other failure is generic. */
export function EventTransitionAction({
  eventName,
  disabledReason,
  run,
  triggerLabel,
  pendingLabel,
  dialogTitle,
  dialogDescription,
  actionLabel,
  successMessage,
  failureMessage,
  refusalHeading,
  invalidateOnRefusal = false,
}: EventTransitionActionProps) {
  const router = useRouter();
  const reasonId = useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, transition, transitioning] = useMutation(async () => {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const refusal = message.startsWith(refusalHeading);
      if (!refusal || invalidateOnRefusal) await router.invalidate();
      throw refusal ? error : new Error();
    }
    try {
      await router.invalidate();
    } catch {
      // The transition already committed; a failed refresh must not report it as a failure.
    }
    toast.success(successMessage);
  }, failureMessage);

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
      <div className="flex items-center gap-1.5">
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger
            render={
              <Button
                size="sm"
                disabled={transitioning || Boolean(disabledReason)}
                aria-label={`${triggerLabel}: ${eventName}`}
                aria-describedby={disabledReason ? reasonId : undefined}
              />
            }
          >
            {transitioning ? pendingLabel : triggerLabel}
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
              <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm" disabled={transitioning}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                size="sm"
                disabled={transitioning}
                onClick={() => void transition()}
              >
                {transitioning ? pendingLabel : actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
            {/* One copy at a time: two live role="alert" nodes would announce twice. */}
            {dialogOpen && refusal}
          </AlertDialogContent>
        </AlertDialog>
        {disabledReason && (
          <Tooltip>
            <TooltipTrigger
              delay={0}
              render={
                <button
                  type="button"
                  aria-label={`${triggerLabel} is disabled: ${disabledReason}`}
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <Info className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{disabledReason}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {disabledReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
      {!dialogOpen && refusal}
    </div>
  );
}
