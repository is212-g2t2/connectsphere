import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import {
  VENUE_REJECTION_REASON_MAX_LENGTH,
  VenueRejectionInput,
} from "#/features/venue-requests/schema";
import { rejectVenueRequest } from "#/features/venue-requests/server-fns";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";

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
  { name: "suggestedDate", id: "rejection-date", label: "Suggested date", type: "date" },
  {
    name: "suggestedStartTime",
    id: "rejection-start",
    label: "Suggested start time",
    type: "time",
  },
  { name: "suggestedEndTime", id: "rejection-end", label: "Suggested end time", type: "time" },
] as const;

/**
 * PTR-34 criteria 1 and 2: Venue Staff reject a pending request with a reason, and may suggest a
 * venue, date or time instead. The server's schema is the gate, so the reason, the suggestion and
 * the paired times are checked once and each issue marks its own field. Like the approval, success
 * lands on a reloaded queue and a refusal reloads the loader in case someone else decided the row.
 */
export function RejectBookingForm({
  request,
  venues,
}: {
  request: Pick<PendingVenueRequest, "id" | "venueName">;
  venues: readonly { id: number; name: string }[];
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: EMPTY,
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueRejectionInput.safeParse(toRejectionInput(request.id, value));
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
        await rejectVenueRequest({ data: toRejectionInput(request.id, value) });
      } catch (error) {
        await router.invalidate();
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not reject this request. Try again.",
          },
        });
        return;
      }
      toast.success(`Booking rejected for ${request.venueName}.`);
      await router.navigate({ to: "/venue-requests" });
      await router.invalidate();
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        // The library has no re-entrancy check, and a second click can land before React disables
        // the button.
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="rejection-reason">Reason for rejection (required)</FieldLabel>
            <Textarea
              id="rejection-reason"
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
                <FieldLabel htmlFor="rejection-venue">Suggested venue</FieldLabel>
                <NativeSelect
                  id="rejection-venue"
                  className="w-full"
                  value={field.state.value}
                  onChange={event => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                >
                  <NativeSelectOption value="">No suggested venue</NativeSelectOption>
                  {venues.map(venue => (
                    <NativeSelectOption key={venue.id} value={String(venue.id)}>
                      {venue.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          {SUGGESTION_INPUTS.map(({ name, id, label, type }) => (
            <form.Field key={name} name={name}>
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={id}>{label}</FieldLabel>
                  <Input
                    id={id}
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
          <Button type="submit" variant="destructive" className="w-fit" disabled={isSubmitting}>
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
