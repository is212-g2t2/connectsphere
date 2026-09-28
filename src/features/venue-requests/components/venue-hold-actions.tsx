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
  const router = useRouter();
  const [state, release, releasing] = useMutation(async () => {
    try {
      await releaseVenueHold({ data: { id: holdId } });
    } catch (error) {
      await router.invalidate();
      throw error;
    }
    toast.success("Tentative hold released.");
    await router.invalidate();
  }, "Could not release this hold. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={releasing}
            aria-label="Release tentative hold"
          />
        }
      >
        {releasing ? "Releasing…" : "Release hold"}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Release tentative hold</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to release this tentative hold? The reserved period will become
            available for other events.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={releasing} onClick={() => void release()}>
            {releasing ? "Releasing…" : "Confirm release"}
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
 * PTR-109: Coordinator converts an active tentative hold to a booking request.
 */
export function ConvertVenueHoldButton({ holdId }: { holdId: string }) {
  const router = useRouter();
  const [state, convert, converting] = useMutation(async () => {
    try {
      await convertVenueHold({ data: { id: holdId } });
    } catch (error) {
      await router.invalidate();
      throw error;
    }
    toast.success("Hold converted to booking request.");
    await router.invalidate();
  }, "Could not convert this hold. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="default"
            disabled={converting}
            aria-label="Convert tentative hold to booking request"
          />
        }
      >
        {converting ? "Converting…" : "Convert to request"}
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Convert hold to booking request</AlertDialogTitle>
          <AlertDialogDescription>
            This will convert the tentative hold into a pending booking request and notify Venue
            Staff for approval.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" disabled={converting} onClick={() => void convert()}>
            {converting ? "Converting…" : "Confirm convert"}
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
    onSubmit: async ({ value, formApi }) => {
      const parsed = VenueRequestInput.safeParse({
        eventId: Number(value.eventId),
        venueId,
        date: value.date,
        startTime: value.startTime,
        endTime: value.endTime,
      });

      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? "");
          if (key && !fields[key]) fields[key] = issue.message;
        }
        formApi.setErrorMap({
          onSubmit: {
            fields,
            form: parsed.error.issues[0]?.message ?? "Invalid input",
          },
        });
        return;
      }

      try {
        await createVenueHold({ data: parsed.data });
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
