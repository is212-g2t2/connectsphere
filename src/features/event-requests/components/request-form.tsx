import { useForm } from "@tanstack/react-form";

import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { EventRequestDraftFormInput } from "#/features/event-requests/schema";
import type {
  EventRequestDraftFormValues,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";

const DEFAULT_VALUES: EventRequestDraftFormValues = {
  eventName: "",
  purpose: "",
  expectedAttendance: "",
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  specialArrangements: "",
  proposedDates: [{ key: crypto.randomUUID(), start: "", end: "" }],
  equipmentRequirements: [],
};

const OPTIONAL_TEXT_FIELDS = [
  ["description", "Description"],
  ["eventType", "Type of event"],
  ["venueRequirements", "Venue requirements"],
  ["roomLayoutPreference", "Room-layout preference"],
  ["accessibilityRequirements", "Accessibility requirements"],
  ["specialArrangements", "Special arrangements"],
] as const;

/**
 * The stored shape and the form shape differ where a value would not survive a round trip through
 * an input: a number, an absent quantity, or no date line at all. This is the one-way mapping.
 */
function toFormValues(initial: EventRequestDraftValues): EventRequestDraftFormValues {
  return {
    eventName: initial.eventName,
    purpose: initial.purpose,
    expectedAttendance:
      initial.expectedAttendance === undefined ? "" : String(initial.expectedAttendance),
    description: initial.description,
    eventType: initial.eventType,
    venueRequirements: initial.venueRequirements,
    roomLayoutPreference: initial.roomLayoutPreference,
    accessibilityRequirements: initial.accessibilityRequirements,
    specialArrangements: initial.specialArrangements,
    proposedDates: (initial.proposedDates.length ? initial.proposedDates : [{}]).map(date => ({
      key: crypto.randomUUID(),
      start: date.start ?? "",
      end: date.end ?? "",
    })),
    equipmentRequirements: initial.equipmentRequirements.map(line => ({
      key: crypto.randomUUID(),
      type: line.type,
      quantity: line.quantity === undefined ? "" : String(line.quantity),
    })),
  };
}

/**
 * A form-level `onSubmit` error is the schema's issue map after a failed validation or the
 * server's message after a failed save; only the latter is a string.
 */
function toFormError(error: unknown): string | undefined {
  return typeof error === "string" ? error : undefined;
}

export function EventRequestForm({
  initialValues,
  onSave,
}: {
  initialValues?: EventRequestDraftValues;
  onSave: (values: EventRequestDraftValues) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: initialValues ? toFormValues(initialValues) : DEFAULT_VALUES,
    validators: { onSubmit: EventRequestDraftFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await onSave(EventRequestDraftFormInput.parse(value));
      } catch (error) {
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save this draft. Try again.",
          },
        });
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="mb-6 text-sm text-muted-foreground">
        Fields marked required must be completed. Anything left blank is saved with the draft, so
        you can finish it later.
      </p>

      <FieldGroup className="gap-8">
        <form.Field name="eventName">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Event name (required)</FieldLabel>
              <Input
                id={field.name}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="purpose">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Purpose (required)</FieldLabel>
              <Textarea
                id={field.name}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="proposedDates" mode="array">
          {field => (
            <fieldset className="space-y-5 border-t border-border pt-6">
              <legend className="font-medium">Proposed dates and times (required)</legend>
              <FieldDescription>
                Enter each proposed window in local time. An end must be later than its start.
              </FieldDescription>
              {field.state.value.map((date, index) => (
                <div key={date.key} className="grid gap-4 sm:grid-cols-2">
                  {(["start", "end"] as const).map(boundary => (
                    <form.Field key={boundary} name={`proposedDates[${index}].${boundary}`}>
                      {boundaryField => (
                        <Field data-invalid={boundaryField.state.meta.errors.length > 0}>
                          <FieldLabel htmlFor={boundaryField.name}>
                            Proposed {boundary} {index + 1} (required)
                          </FieldLabel>
                          <Input
                            id={boundaryField.name}
                            type="datetime-local"
                            required
                            value={boundaryField.state.value}
                            onBlur={boundaryField.handleBlur}
                            onChange={event => boundaryField.handleChange(event.target.value)}
                            aria-invalid={boundaryField.state.meta.errors.length > 0}
                          />
                          <FieldError errors={boundaryField.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                  ))}
                  {field.state.value.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-self-start"
                      onClick={() => field.removeValue(index)}
                    >
                      Remove proposed date {index + 1}
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => field.pushValue({ key: crypto.randomUUID(), start: "", end: "" })}
              >
                Add proposed date
              </Button>
            </fieldset>
          )}
        </form.Field>

        <form.Field name="expectedAttendance">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Expected attendance (required)</FieldLabel>
              <Input
                id={field.name}
                type="number"
                min="1"
                step="1"
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <section
          className="space-y-6 border-t border-border pt-6"
          aria-label="Optional requirements"
        >
          <h3 className="font-medium">Additional requirements</h3>
          {OPTIONAL_TEXT_FIELDS.map(([name, label]) => (
            <form.Field key={name} name={name}>
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={field.name}>{label} (optional)</FieldLabel>
                  {name === "eventType" ? (
                    <Input
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={event => field.handleChange(event.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                  ) : (
                    <Textarea
                      id={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={event => field.handleChange(event.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                  )}
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ))}
        </section>

        <form.Field name="equipmentRequirements" mode="array">
          {field => (
            <fieldset className="space-y-5 border-t border-border pt-6">
              <legend className="font-medium">Equipment requirements (optional)</legend>
              {field.state.value.map((equipment, index) => (
                <div key={equipment.key} className="grid gap-4 sm:grid-cols-2">
                  {(["type", "quantity"] as const).map(part => (
                    <form.Field key={part} name={`equipmentRequirements[${index}].${part}`}>
                      {partField => (
                        <Field data-invalid={partField.state.meta.errors.length > 0}>
                          <FieldLabel htmlFor={partField.name}>
                            {part === "type" ? "Equipment type" : "Quantity"} {index + 1}
                          </FieldLabel>
                          <Input
                            id={partField.name}
                            {...(part === "quantity"
                              ? { type: "number", min: "1", step: "1" }
                              : {})}
                            value={partField.state.value}
                            onBlur={partField.handleBlur}
                            onChange={event => partField.handleChange(event.target.value)}
                            aria-invalid={partField.state.meta.errors.length > 0}
                          />
                          <FieldError errors={partField.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => field.removeValue(index)}
                  >
                    Remove equipment {index + 1}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  field.pushValue({ key: crypto.randomUUID(), type: "", quantity: "" })
                }
              >
                Add equipment
              </Button>
            </fieldset>
          )}
        </form.Field>

        <form.Subscribe selector={state => state.errorMap.onSubmit}>
          {onSubmitError => {
            const message = toFormError(onSubmitError);
            return message ? <FieldError>{message}</FieldError> : null;
          }}
        </form.Subscribe>

        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <div className="border-t border-border pt-6">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save draft"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
