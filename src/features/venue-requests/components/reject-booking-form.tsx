import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { formatProposedWindow } from "#/features/event-requests/format";
import {
  VENUE_REJECTION_REASON_MAX_LENGTH,
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  VenueRejectionInput,
  formIssues,
} from "#/features/venue-requests/schema";
import { rejectVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import type { VenueOption } from "#/features/events/page-data";
import { skipRootFilter } from "#/lib/invalidate";

/** What the inputs hold. Field names match `VenueRejectionInput`, so an issue lands on its field. */
interface FormValues {
  reason: string;
  suggestedVenueId: string;
  suggestedDate: string;
  suggestedStartTime: string;
  suggestedEndTime: string;
}

const EMPTY: FormValues = {
  reason: "",
  suggestedVenueId: "",
  suggestedDate: "",
  suggestedStartTime: "",
  suggestedEndTime: "",
};

/** A blank input means "not suggested", which the server schema spells as an absent key. */
function toRejectionInput(id: string, values: FormValues) {
  return {
    id,
    reason: values.reason,
    suggestedVenueId: values.suggestedVenueId ? Number(values.suggestedVenueId) : undefined,
    suggestedDate: values.suggestedDate || undefined,
    suggestedStartTime: values.suggestedStartTime || undefined,
    suggestedEndTime: values.suggestedEndTime || undefined,
  };
}

/** The suggestion's plain inputs; the reason and the venue select differ enough to stay inline. */
const SUGGESTION_INPUTS = [
  { name: "suggestedDate", base: "rejection-date", label: "Suggested date", type: "date" },
  {
    name: "suggestedStartTime",
    base: "rejection-start",
    label: "Suggested start time",
    type: "time",
  },
  { name: "suggestedEndTime", base: "rejection-end", label: "Suggested end time", type: "time" },
] as const;

/**
 * PTR-34 criteria 1 and 2: Let Venue Staff reject a pending request with a reason and an optional
 * suggested venue, date, or time. The server schema checks the reason, suggestion, and paired times.
 * Show each issue by its field.
 * On success, reload the queue. If someone else decided the request, show a toast and return to
 * the queue. A loader reload here would return 404 and remove the form before it could show the
 * error. For other refusals, reload the loader and keep the message by the form.
 */
export function RejectBookingForm({
  request,
  venues,
  onDecided,
}: {
  request: Pick<PendingVenueRequest, "id" | "venueId" | "venueName" | "startsAt" | "endsAt">;
  venues: readonly VenueOption[];
  /**
   * Where to go after a decision. The old detail page returns to the queue.
   * The event page stays open and reloads its data; the request leaves `pending` and its decision block disappears.
   */
  onDecided?: () => Promise<void> | void;
}) {
  // Do not suggest the same venue that staff just rejected. For example, a "fully booked" refusal
  // must not offer the same venue as an alternative.
  const suggestableVenues = venues.filter(venue => venue.id !== request.venueId);
  const router = useRouter();
  const form = useForm({
    defaultValues: EMPTY,
    validators: {
      onSubmit: ({ value }) => formIssues(VenueRejectionInput, toRejectionInput(request.id, value)),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await rejectVenueRequest({ data: toRejectionInput(request.id, value) });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not reject this request. Try again.";

        // Someone else already settled this row. Reloading would return `notFound()` and unmount
        // the form before it could show the error. Show a toast and return to the dashboard.
        const alreadySettled =
          message === VENUE_REQUEST_REJECTED_MESSAGE || message === VENUE_REQUEST_DECIDED_MESSAGE;
        if (alreadySettled) {
          toast.error(message);
          if (onDecided) {
            await onDecided();
            return;
          }
          await router.navigate({ to: "/dashboard" });
          await router.invalidate({ filter: skipRootFilter });
          return;
        }

        // `fields` marks this as a global error and stores `form` verbatim.
        // Set the message before invalidating. A reload failure must not hide it.
        formApi.setErrorMap({ onSubmit: { fields: {}, form: message } });
        await router.invalidate({ filter: skipRootFilter }).catch(() => {
          // Best effort, as above. The refusal is already shown.
        });
        return;
      }
      toast.success(`Booking rejected for ${request.venueName}.`);
      if (onDecided) {
        await onDecided();
        return;
      }
      await router.navigate({ to: "/dashboard" });
      await router.invalidate({ filter: skipRootFilter });
    },
  });

  // Key every control id by request: the staff page renders one reject form per pending request.
  // Name the form and its submit with the venue and window: several forms share the page.
  const reasonId = `rejection-reason-${request.id}`;
  const venueId = `rejection-venue-${request.id}`;
  const formName = `Reject request for ${request.venueName}, ${formatProposedWindow({ start: request.startsAt, end: request.endsAt })}`;
  return (
    <form
      noValidate
      aria-label={formName}
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        // The library has no re-entrancy check. A second click can arrive before React disables the button.
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={reasonId}>Reason for rejection (required)</FieldLabel>
            <Textarea
              id={reasonId}
              value={field.state.value}
              maxLength={VENUE_REJECTION_REASON_MAX_LENGTH}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <FieldSet>
        <FieldLegend variant="label">Suggest an alternative (optional)</FieldLegend>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="suggestedVenueId">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={venueId}>Suggested venue</FieldLabel>
                <Select
                  value={field.state.value === "" ? null : field.state.value}
                  onValueChange={value => field.handleChange(value ?? "")}
                >
                  <SelectTrigger
                    id={venueId}
                    className="w-full"
                    aria-invalid={field.state.meta.errors.length > 0}
                    onBlur={field.handleBlur}
                  >
                    <SelectValue>
                      {(value: string | null) =>
                        suggestableVenues.find(venue => String(venue.id) === value)?.name ??
                        "No suggested venue"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {suggestableVenues.map(venue => (
                      <SelectItem key={venue.id} value={String(venue.id)}>
                        {venue.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          {SUGGESTION_INPUTS.map(({ name, base, label, type }) => (
            <form.Field key={name} name={name}>
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={`${base}-${request.id}`}>{label}</FieldLabel>
                  <Input
                    id={`${base}-${request.id}`}
                    type={type}
                    value={field.state.value}
                    aria-invalid={field.state.meta.errors.length > 0}
                    onChange={event => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ))}
        </div>
      </FieldSet>

      <form.Subscribe selector={state => state.isSubmitting}>
        {isSubmitting => (
          <Button
            type="submit"
            variant="destructive"
            className="w-fit"
            disabled={isSubmitting}
            aria-label={formName}
          >
            {isSubmitting ? "Rejecting…" : "Reject request"}
          </Button>
        )}
      </form.Subscribe>
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>
    </form>
  );
}
