import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Field, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { setVenueHoldExpiry, setVenueHoldWarning } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

interface HoldTimeDialogProps {
  triggerLabel: string;
  title: string;
  description: string;
  /** The saved value as `YYYY-MM-DDTHH:MM:SS`, or null when none is set. */
  current: string | null;
  save: (value: string) => Promise<unknown>;
  /** Set only where the value may be cleared. The expiry cannot be: no hold stays active without one. */
  clear?: () => Promise<unknown>;
  successMessage: string;
}

/** The dialog's form. It mounts when the dialog opens, so a reopened dialog starts clean. */
function HoldTimeForm({
  current,
  save,
  clear,
  successMessage,
  onDone,
}: Pick<HoldTimeDialogProps, "current" | "save" | "clear" | "successMessage"> & {
  onDone: () => void;
}) {
  const [value, setValue] = useState(current?.slice(0, 16) ?? "");
  const router = useRouter();
  const [state, run, pending] = useMutation(async (next: string | null) => {
    await (next === null ? clear?.() : save(next));
    toast.success(successMessage);
    onDone();
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not save. Try again.");

  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        void run(value);
      }}
    >
      <Field>
        <FieldLabel htmlFor="hold-time">Date and time</FieldLabel>
        <Input
          id="hold-time"
          type="datetime-local"
          value={value}
          onChange={event => setValue(event.target.value)}
          required={clear === undefined}
        />
      </Field>
      {state.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        {clear !== undefined && current !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void run(null)}
          >
            Clear
          </Button>
        )}
        <Button type="submit" size="sm" disabled={pending || value === ""}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** One date-and-time field in a dialog, shared by the expiry and the warning. */
function HoldTimeDialog({ triggerLabel, title, description, ...form }: HoldTimeDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <HoldTimeForm {...form} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * PTR-142 AC1, AC2, AC4: Venue Staff set, extend or shorten a hold's expiry. The server records
 * who changed it and tells the Coordinator.
 */
export function SetVenueHoldExpiryButton({
  holdId,
  expiresAt,
}: {
  holdId: string;
  expiresAt: string | null;
}) {
  return (
    <HoldTimeDialog
      triggerLabel={expiresAt === null ? "Set expiry" : "Change expiry"}
      title="Hold expiry"
      description="The hold stays active until this venue-local date and time. The Coordinator is notified of the change."
      current={expiresAt}
      save={value => setVenueHoldExpiry({ data: { id: holdId, expiresAt: value } })}
      successMessage="Hold expiry saved."
    />
  );
}

/** PTR-142 AC3: the Coordinator sets an absolute warning time for the hold, or clears it. */
export function SetVenueHoldWarningButton({
  holdId,
  warnAt,
}: {
  holdId: string;
  warnAt: string | null;
}) {
  return (
    <HoldTimeDialog
      triggerLabel={warnAt === null ? "Set warning" : "Change warning"}
      title="Hold warning"
      description="You are warned at this venue-local date and time, before the hold expires. An extended expiry does not move it."
      current={warnAt}
      save={value => setVenueHoldWarning({ data: { id: holdId, warnAt: value } })}
      clear={() => setVenueHoldWarning({ data: { id: holdId, warnAt: null } })}
      successMessage="Hold warning saved."
    />
  );
}
