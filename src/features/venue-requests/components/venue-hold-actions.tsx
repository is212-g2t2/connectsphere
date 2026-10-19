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
import { SessionRequirementFields } from "#/features/venue-requests/components/session-requirement-fields";
import {
  VenueHoldConversionInput,
  VenueRequestInput,
  formIssues,
  sessionRequirementFormValues,
  sessionRequirementInput,
} from "#/features/venue-requests/schema";
import type {
  SessionRequirementFormValues,
  SessionRequirements,
} from "#/features/venue-requests/schema";
import {
  convertVenueHold,
  releaseVenueHold,
  requestVenueHold,
  withdrawVenueHoldRequest,
} from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

export interface CoordinatorEventOption {
  id: number;
  name: string;
}

/**
 * PTR-109 AC5: Coordinator releases an active tentative hold after a confirmation. A refusal stays
 * in the dialog, and the calendar reloads.
 */
export function ReleaseVenueHoldButton({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [state, release, pending] = useMutation(async () => {
    try {
      await releaseVenueHold({ data: { id: holdId } });
    } catch (error) {
      await router.invalidate({ filter: skipRootFilter });
      throw error;
    }
    toast.success("Tentative hold released.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not release this hold. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            aria-label="Release tentative hold"
          />
        }
      >
        {pending ? "Releasing…" : "Release hold"}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Release tentative hold</AlertDialogTitle>
          <AlertDialogDescription>
            This releases the tentative hold. The period becomes available for other events.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={pending} onClick={() => void release()}>
            {pending ? "Releasing…" : "Confirm release"}
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

/**
 * PTR-151 AC3: the Coordinator withdraws a hold request before Venue Staff place it. The request
 * protects no venue time, so the confirmation says that only the queue entry closes.
 */
export function WithdrawVenueHoldRequestButton({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [state, withdraw, pending] = useMutation(async () => {
    try {
      await withdrawVenueHoldRequest({ data: { id: holdId } });
    } catch (error) {
      // Venue Staff may have placed or declined the request meanwhile. Reload, keeping the refusal.
      await router.invalidate({ filter: skipRootFilter });
      throw error;
    }
    toast.success("Hold request withdrawn.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not withdraw this hold request. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            aria-label="Withdraw hold request"
          />
        }
      >
        {pending ? "Withdrawing…" : "Withdraw request"}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw hold request</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the request from the Venue Staff queue. It never reserved venue time, so
            the period stays first come, first served.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={pending} onClick={() => void withdraw()}>
            {pending ? "Withdrawing…" : "Confirm withdrawal"}
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

/** The conversion's server input: the hold and the session requirements as the form holds them. */
function toConversionInput(holdId: string, values: SessionRequirementFormValues) {
  return { id: holdId, ...sessionRequirementInput(values) };
}

/**
 * PTR-109 AC5: Coordinator converts an active tentative hold to a booking request.
 * PTR-138 AC1: the request carries session requirements. They start from the event's
 * requirements, and the venue must meet them. Show each issue by its field, and a server refusal
 * in the form, as `reject-booking-form.tsx` does.
 */
export function ConvertVenueHoldButton({
  holdId,
  requirements,
}: {
  holdId: string;
  requirements: SessionRequirements;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm({
    defaultValues: sessionRequirementFormValues(requirements),
    validators: {
      onSubmit: ({ value }) =>
        formIssues(VenueHoldConversionInput, toConversionInput(holdId, value)),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await convertVenueHold({ data: toConversionInput(holdId, value) });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not convert this hold. Try again.",
          },
        });
        // The hold may have changed since the calendar loaded. Reload it, keeping the message.
        await router.invalidate({ filter: skipRootFilter }).catch(() => {});
        return;
      }
      toast.success("Hold converted to booking request.");
      setOpen(false);
      await router.invalidate({ filter: skipRootFilter });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" aria-label="Convert tentative hold to booking request" />}
      >
        Convert to request
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert hold to booking request</DialogTitle>
          <DialogDescription>
            This converts the tentative hold into a pending booking request and notifies Venue
            Staff. The session requirements start from the event&apos;s, and the venue must meet
            them.
          </DialogDescription>
        </DialogHeader>
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
          <SessionRequirementFields form={form} idPrefix={`convert-${holdId}`} />
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
                    {isSubmitting ? "Converting…" : "Confirm conversion"}
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

const EMPTY_COORDINATOR_EVENTS: readonly CoordinatorEventOption[] = [];

/** The event select stores its id as text; the schema and server require a number. */
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
 * PTR-151 AC1: the Coordinator asks Venue Staff to hold a venue for an event. The request does
 * not reserve the period; Venue Staff place it with an expiry from their queue.
 */
export function RequestVenueHoldDialog({
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
    // `VenueRequestInput` uses the server's rules. Validate the date and times once, then mark each
    // field with its issue, as `reject-booking-form.tsx` does. Convert the event id from text to a number.
    validators: {
      onSubmit: ({ value }) => formIssues(VenueRequestInput, toHoldInput(venueId, value)),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenueHold({ data: toHoldInput(venueId, value) });
        toast.success("Hold requested.");
        setOpen(false);
        await router.invalidate({ filter: skipRootFilter });
      } catch (submitError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              submitError instanceof Error
                ? submitError.message
                : "Could not request this hold. Try again.",
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
              Request hold
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a hold</DialogTitle>
          <DialogDescription>
            Ask Venue Staff to hold {venueName} for an event. A request protects nothing until Venue
            Staff place it; the period stays first come, first served at placement.
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
              You have no events that can take a venue hold request.
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
                    {isSubmitting ? "Requesting…" : "Send request"}
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
