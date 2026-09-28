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
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { VenueRequestInput } from "#/features/venue-requests/schema";
import {
  convertVenueHold,
  createVenueHold,
  releaseVenueHold,
} from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

export interface CoordinatorEventOption {
  id: number;
  name: string;
}

/**
 * PTR-109: Coordinator releases an active tentative hold.
 */
export function ReleaseVenueHoldButton({ holdId }: { holdId: string }) {
  return <ConfirmHoldAction holdId={holdId} kind="release" />;
}

/**
 * PTR-109: Coordinator converts an active tentative hold to a booking request.
 */
export function ConvertVenueHoldButton({ holdId }: { holdId: string }) {
  return <ConfirmHoldAction holdId={holdId} kind="convert" />;
}

type HoldActionKind = "release" | "convert";

const HOLD_ACTIONS: Record<
  HoldActionKind,
  {
    title: string;
    description: string;
    triggerLabel: string;
    pendingLabel: string;
    confirmLabel: string;
    ariaLabel: string;
    variant: "outline" | "default";
    successMessage: string;
    errorMessage: string;
    run: (holdId: string) => Promise<unknown>;
  }
> = {
  release: {
    title: "Release tentative hold",
    description: "This releases the tentative hold. The period becomes available for other events.",
    triggerLabel: "Release hold",
    pendingLabel: "Releasing…",
    confirmLabel: "Confirm release",
    ariaLabel: "Release tentative hold",
    variant: "outline",
    successMessage: "Tentative hold released.",
    errorMessage: "Could not release this hold. Try again.",
    run: holdId => releaseVenueHold({ data: { id: holdId } }),
  },
  convert: {
    title: "Convert hold to booking request",
    description:
      "This will convert the tentative hold into a pending booking request and notify Venue Staff for approval.",
    triggerLabel: "Convert to request",
    pendingLabel: "Converting…",
    confirmLabel: "Confirm conversion",
    ariaLabel: "Convert tentative hold to booking request",
    variant: "default",
    successMessage: "Hold converted to booking request.",
    errorMessage: "Could not convert this hold. Try again.",
    run: holdId => convertVenueHold({ data: { id: holdId } }),
  },
};

function ConfirmHoldAction({ holdId, kind }: { holdId: string; kind: HoldActionKind }) {
  const copy = HOLD_ACTIONS[kind];
  const router = useRouter();
  const [state, run, pending] = useMutation(async () => {
    try {
      await copy.run(holdId);
    } catch (error) {
      await router.invalidate();
      throw error;
    }
    toast.success(copy.successMessage);
    await router.invalidate();
  }, copy.errorMessage);

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button size="sm" variant={copy.variant} disabled={pending} aria-label={copy.ariaLabel} />
        }
      >
        {pending ? copy.pendingLabel : copy.triggerLabel}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={pending} onClick={() => void run()}>
            {pending ? copy.pendingLabel : copy.confirmLabel}
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

const EMPTY_COORDINATOR_EVENTS: readonly CoordinatorEventOption[] = [];

/** The event select holds its id as text; the schema (and the server) wants numbers. */
function toHoldInput(
  venueId: number,
  value: { eventId: string; date: string; startTime: string; endTime: string }
) {
  return {
    eventId: Number(value.eventId),
    venueId,
    date: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
  };
}

/**
 * PTR-109: Coordinator places a tentative hold naming venue, event, date and period.
 */
export function PlaceVenueHoldDialog({
  venueId,
  venueName,
  defaultDate = "",
  defaultStartTime = "09:00",
  defaultEndTime = "12:00",
  coordinatorEvents = EMPTY_COORDINATOR_EVENTS,
  trigger,
}: {
  venueId: number;
  venueName: string;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  coordinatorEvents?: readonly CoordinatorEventOption[];
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const hasEvents = coordinatorEvents.length > 0;
  const initialEventId = hasEvents ? String(coordinatorEvents[0].id) : "";

  const form = useForm({
    defaultValues: {
      eventId: initialEventId,
      date: defaultDate,
      startTime: defaultStartTime,
      endTime: defaultEndTime,
    },
    // `VenueRequestInput` is the same gate the server uses, so the date and the times are
    // checked once and every issue marks its own field, the pattern `reject-booking-form.tsx`
    // follows. The select holds the event id as text, so it is adapted to the schema's number.
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueRequestInput.safeParse(toHoldInput(venueId, value));
        if (parsed.success) return undefined;
        const fields: Record<string, { message: string }> = {};
        for (const issue of parsed.error.issues) {
          fields[String(issue.path[0])] ??= { message: issue.message };
        }
        return { fields };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await createVenueHold({ data: toHoldInput(venueId, value) });
        toast.success("Tentative hold placed.");
        setOpen(false);
        await router.invalidate();
      } catch (submitError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              submitError instanceof Error
                ? submitError.message
                : "Could not place hold. Try again.",
          },
        });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size="sm" variant="outline">
              Place tentative hold
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place tentative hold</DialogTitle>
          <DialogDescription>
            Tentatively reserve {venueName} for an event while planning.
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
          {hasEvents ? (
            <form.Field name="eventId">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="hold-event">Event</FieldLabel>
                  <Select
                    value={field.state.value === "" ? null : field.state.value}
                    onValueChange={value => field.handleChange(value ?? "")}
                  >
                    <SelectTrigger
                      id="hold-event"
                      className="w-full"
                      aria-invalid={field.state.meta.errors.length > 0}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue>
                        {(value: string | null) =>
                          coordinatorEvents.find(option => String(option.id) === value)?.name ??
                          "Select an event"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {coordinatorEvents.map(eventOption => (
                        <SelectItem key={eventOption.id} value={String(eventOption.id)}>
                          {eventOption.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ) : (
            <p className="body-sm text-muted-foreground">
              You have no submitted events to hold a venue for.
            </p>
          )}

          <form.Field name="date">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor="hold-date">Date</FieldLabel>
                <Input
                  id="hold-date"
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

          <div className="grid grid-cols-2 gap-4">
            <form.Field name="startTime">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="hold-start-time">Start time</FieldLabel>
                  <Input
                    id="hold-start-time"
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

            <form.Field name="endTime">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="hold-end-time">End time</FieldLabel>
                  <Input
                    id="hold-end-time"
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
          </div>

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
                  <Button type="submit" size="sm" disabled={Boolean(isSubmitting) || !hasEvents}>
                    {isSubmitting ? "Placing hold…" : "Place hold"}
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
