import { useState } from "react";
import { useForm } from "@tanstack/react-form";
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
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  HoldLocalDateTime,
  VENUE_HOLD_EXPIRY_MESSAGE,
  VENUE_HOLD_WARNING_MESSAGE,
} from "#/features/venue-requests/schema";
import { setVenueHoldExpiry, setVenueHoldWarning } from "#/features/venue-requests/server-fns";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { skipRootFilter } from "#/lib/invalidate";

interface HoldTimeDialogProps {
  triggerLabel: string;
  title: string;
  description: string;
  /** The saved value as `YYYY-MM-DDTHH:MM:SS`, or null when the hold has no value. */
  current: string | null;
  saveLabel: string;
  save: (value: string) => Promise<unknown>;
  /** Set only when the user can clear the value. The expiry cannot be cleared. */
  clear?: () => Promise<unknown>;
  successMessage: string;
}

/** The venue clock as a `datetime-local` minimum, `YYYY-MM-DDTHH:MM`. */
function venueMinuteMinimum() {
  return toLocalMinuteValue(venueLocalTimestamp(new Date()));
}

/** The form of the dialog. It mounts when the dialog opens, so a reopened dialog has no stale state. */
function HoldTimeForm({
  current,
  saveLabel,
  save,
  clear,
  successMessage,
  onDone,
}: Pick<HoldTimeDialogProps, "current" | "saveLabel" | "save" | "clear" | "successMessage"> & {
  onDone: () => void;
}) {
  const router = useRouter();
  // The server refuses a past value. This guard prevents the submit, but the server decides.
  const [min] = useState(venueMinuteMinimum);
  // The Clear button sends its own request, so it has its own pending flag and error.
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { value: current?.slice(0, 16) ?? "" },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = HoldLocalDateTime(
          clear === undefined ? VENUE_HOLD_EXPIRY_MESSAGE : VENUE_HOLD_WARNING_MESSAGE
        ).safeParse(value.value);
        return parsed.success
          ? undefined
          : { fields: { value: { message: parsed.error.issues[0].message } } };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      setClearError(null);
      try {
        await save(value.value);
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not save. Try again.",
          },
        });
        // The hold can change after the calendar loads. Reload the calendar, but keep the message.
        await router.invalidate({ filter: skipRootFilter }).catch(() => {});
        return;
      }
      toast.success(successMessage);
      onDone();
      await router.invalidate({ filter: skipRootFilter });
    },
  });

  async function handleClear() {
    if (clear === undefined) return;
    setClearError(null);
    setClearing(true);
    try {
      await clear();
    } catch (error) {
      setClearError(
        error instanceof Error && error.message ? error.message : "Could not save. Try again."
      );
      // The hold can change after the calendar loads. Reload the calendar, but keep the message.
      await router.invalidate({ filter: skipRootFilter }).catch(() => {});
      return;
    } finally {
      setClearing(false);
    }
    toast.success(successMessage);
    onDone();
    await router.invalidate({ filter: skipRootFilter });
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={event => {
        event.preventDefault();
        event.stopPropagation();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="value">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="hold-time">Date and time</FieldLabel>
            <Input
              id="hold-time"
              type="datetime-local"
              min={min}
              value={field.state.value}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe
        selector={state => [state.isSubmitting, state.errorMap.onSubmit, state.values.value]}
      >
        {([isSubmitting, onSubmitError, value]) => {
          const message = clearError ?? (typeof onSubmitError === "string" ? onSubmitError : null);
          return (
            <>
              {message !== null ? (
                <p role="alert" className="body-sm text-destructive">
                  {message}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(isSubmitting) || clearing}
                  onClick={onDone}
                >
                  Cancel
                </Button>
                {clear !== undefined && current !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(isSubmitting) || clearing}
                    onClick={() => void handleClear()}
                  >
                    {clearing ? "Clearing…" : "Clear"}
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={Boolean(isSubmitting) || clearing || value === ""}
                >
                  {isSubmitting ? "Saving…" : saveLabel}
                </Button>
              </div>
            </>
          );
        }}
      </form.Subscribe>
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
 * PTR-142 AC1, AC2, AC4: Venue Staff set, extend or shorten the expiry of a hold. The server
 * records the user and the time, and tells the Coordinator.
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
      description="The hold expires at this venue-local date and time. The Coordinator is notified of the change."
      current={expiresAt}
      saveLabel="Save expiry"
      save={value => setVenueHoldExpiry({ data: { id: holdId, expiresAt: value } })}
      successMessage="Hold expiry saved."
    />
  );
}

/** PTR-142 AC3: the Coordinator sets a fixed warning time for the hold, or clears it. */
export function SetVenueHoldWarningButton({
  holdId,
  warnAt,
  expiresAt,
}: {
  holdId: string;
  warnAt: string | null;
  /** A warning needs an expiry. Hide the trigger until the hold has one. */
  expiresAt: string | null;
}) {
  if (expiresAt === null) return null;
  return (
    <HoldTimeDialog
      triggerLabel={warnAt === null ? "Set warning" : "Change warning"}
      title="Hold warning"
      description="You are warned at this venue-local date and time, before the hold expires. An extended expiry does not move it."
      current={warnAt}
      saveLabel="Save warning"
      save={value => setVenueHoldWarning({ data: { id: holdId, warnAt: value } })}
      clear={() => setVenueHoldWarning({ data: { id: holdId, warnAt: null } })}
      successMessage="Hold warning saved."
    />
  );
}
