import { useState } from "react";
import { useForm } from "@tanstack/react-form";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import {
  VENUE_BLOCK_ALREADY_LIFTED_MESSAGE,
  VENUE_BLOCK_LIFT_OVERLAP_MESSAGE,
  VENUE_BLOCK_REASON_MAX_LENGTH,
  VENUE_BLOCK_RETRY_MESSAGE,
  VenueBlockInput,
} from "#/features/venues/schema";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { formIssues } from "#/features/venue-requests/schema";
import { liftVenueBlock, recordVenueBlock } from "#/features/venues/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

const LIFT_FALLBACK_MESSAGE = "Could not lift this block. Try again.";

/**
 * Format a block period as wall-clock text. Name the end day only when it differs from the start
 * day. An absent end reads as "until lifted". Both values start `YYYY-MM-DDTHH:MM`.
 */
function formatBlockPeriod(startsAt: string, endsAt?: string): string {
  const start = formatLocalDateTime(startsAt.slice(0, 16));
  if (endsAt === undefined) return `${start} – until lifted`;
  const end =
    endsAt.slice(0, 10) === startsAt.slice(0, 10)
      ? endsAt.slice(11, 16)
      : formatLocalDateTime(endsAt.slice(0, 16));
  return `${start} – ${end}`;
}

/** The server sends these refusals for the block itself or a retry. Show them verbatim. */
const LIFT_REFUSALS: ReadonlySet<string> = new Set([
  VENUE_BLOCK_ALREADY_LIFTED_MESSAGE,
  VENUE_BLOCK_LIFT_OVERLAP_MESSAGE,
  VENUE_BLOCK_RETRY_MESSAGE,
]);

/** Lift a block and free its period. Refusals name the block state, so show them verbatim. */
export function LiftVenueBlockButton({
  blockId,
  reason,
  startsAt,
  endsAt,
  openEnded,
}: {
  blockId: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  openEnded?: true;
}) {
  const router = useRouter();
  const period = formatBlockPeriod(startsAt, openEnded ? undefined : endsAt);
  const [state, run, pending] = useMutation(async () => {
    try {
      // The calendar carries ids as text. The schema wants the numeric row id.
      await liftVenueBlock({ data: { id: Number(blockId) } });
    } catch (error) {
      await router.invalidate({ filter: skipRootFilter });
      const message = error instanceof Error ? error.message : "";
      if (LIFT_REFUSALS.has(message)) throw error;
      throw new Error(LIFT_FALLBACK_MESSAGE, { cause: error });
    }
    toast.success("Venue block lifted.");
    await router.invalidate({ filter: skipRootFilter });
  }, LIFT_FALLBACK_MESSAGE);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            aria-label={`Lift venue block, ${period}`}
          />
        }
      >
        {pending ? "Lifting…" : "Lift block"}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Lift venue block</AlertDialogTitle>
          <AlertDialogDescription>
            This lifts the block on {period} ({reason}). Lifting removes the block and frees the
            period, unless a new arrangement now overlaps it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={pending} onClick={() => void run()}>
            {pending ? "Lifting…" : "Confirm lift"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {state.status === "error" && (
          <p role="alert" className="body-sm text-destructive">
            {state.error}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface BlockFormValues {
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  reason: string;
}

/** A blank end input means "until lifted", which the server schema spells as an absent key. */
function toBlockInput(venueId: number, value: BlockFormValues) {
  return {
    venueId,
    date: value.date,
    startTime: value.startTime,
    endDate: value.endDate || undefined,
    endTime: value.endTime || undefined,
    reason: value.reason,
  };
}

/** Venue Staff record a block naming venue, start, optional end, and reason. */
export function RecordVenueBlockDialog({
  venueId,
  venueName,
  defaultDate = "",
}: {
  venueId: number;
  venueName: string;
  defaultDate?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      date: defaultDate,
      startTime: "09:00",
      endDate: "",
      endTime: "",
      reason: "",
    },
    // `VenueBlockInput` uses the server's rules. Blank end inputs read as absent keys.
    validators: {
      onSubmit: ({ value }) => formIssues(VenueBlockInput, toBlockInput(venueId, value)),
    },
    onSubmit: async ({ value, formApi }) => {
      const input = toBlockInput(venueId, value);
      try {
        await recordVenueBlock({ data: input });
        const end =
          input.endDate && input.endTime ? `${input.endDate}T${input.endTime}` : undefined;
        toast.success(
          `Block recorded: ${formatBlockPeriod(`${input.date}T${input.startTime}`, end)}.`
        );
        setOpen(false);
        await router.invalidate({ filter: skipRootFilter });
      } catch (submitError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              submitError instanceof Error
                ? submitError.message
                : "Could not record block. Try again.",
          },
        });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            Block venue
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block venue</DialogTitle>
          <DialogDescription>
            Record {venueName} as unavailable. Coordinators see the period as blocked. Bookings or
            holds that overlap this period are suspended until you lift the block, and their
            Coordinators are notified.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={event => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="date">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="block-venue-date">Date</FieldLabel>
                <Input
                  id="block-venue-date"
                  type="date"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="startTime">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="block-venue-start">Start time</FieldLabel>
                <Input
                  id="block-venue-start"
                  type="time"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="endDate">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="block-venue-end-date">End date (optional)</FieldLabel>
                <Input
                  id="block-venue-end-date"
                  type="date"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldDescription>
                  Leave the end empty to block the venue until lifted.
                </FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="endTime">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="block-venue-end-time">End time</FieldLabel>
                <Input
                  id="block-venue-end-time"
                  type="time"
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="reason">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="block-venue-reason">Reason for block</FieldLabel>
                <Textarea
                  id="block-venue-reason"
                  value={field.state.value}
                  maxLength={VENUE_BLOCK_REASON_MAX_LENGTH}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onChange={event => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={state => [state.isSubmitting, state.errorMap.onSubmit]}>
            {([isSubmitting, onSubmitError]) => (
              <>
                {typeof onSubmitError === "string" ? (
                  <p role="alert" className="body-sm text-destructive">
                    {onSubmitError}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={Boolean(isSubmitting)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={Boolean(isSubmitting)}>
                    {isSubmitting ? "Recording…" : "Record block"}
                  </Button>
                </div>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
