import { useForm } from "@tanstack/react-form";
import type { FormOptions } from "@tanstack/react-form";

import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { EventRequestDraftInput } from "#/features/event-requests/schema";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";

interface DraftFormValues {
  eventName: string;
  purpose: string;
  proposedStart: string;
  proposedEnd: string;
  expectedAttendance: string;
}

const DEFAULT_VALUES: DraftFormValues = {
  eventName: "",
  purpose: "",
  proposedStart: "",
  proposedEnd: "",
  expectedAttendance: "",
};

function toDraftValues(values: DraftFormValues): EventRequestDraftValues {
  const draft: EventRequestDraftValues = {
    eventName: values.eventName,
    purpose: values.purpose,
  };

  if (values.proposedStart) {
    draft.proposedStart = values.proposedStart;
  }
  if (values.proposedEnd) {
    draft.proposedEnd = values.proposedEnd;
  }
  if (values.expectedAttendance) {
    draft.expectedAttendance = Number(values.expectedAttendance);
  }

  return draft;
}

interface DraftFormErrors {
  fields: Record<string, { message: string }[]>;
}

function validateDraft(value: DraftFormValues): DraftFormErrors | undefined {
  const parsed = EventRequestDraftInput.safeParse(toDraftValues(value));
  if (parsed.success) {
    return undefined;
  }

  const fields: DraftFormErrors["fields"] = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    (fields[path] ??= []).push({ message: issue.message });
  }

  return { fields };
}

type DraftFormOptions = FormOptions<
  DraftFormValues,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  (props: { value: DraftFormValues }) => DraftFormErrors | undefined,
  undefined,
  undefined,
  undefined,
  () => string | undefined,
  undefined
>;

export function EventRequestDraftForm({
  onSave,
}: {
  onSave: (values: EventRequestDraftValues) => Promise<void>;
}) {
  const formOpts: DraftFormOptions = {
    defaultValues: DEFAULT_VALUES,
    validators: { onSubmit: ({ value }) => validateDraft(value) },
    onSubmit: async ({ value, formApi }) => {
      try {
        await onSave(toDraftValues(value));
      } catch (error) {
        formApi.setErrorMap({
          onServer:
            error instanceof Error ? error.message : "Could not save this draft. Try again.",
        });
      }
    },
  };

  const form = useForm(formOpts);

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup className="gap-5">
        <form.Field name="eventName">
          {field => (
            <Field>
              <FieldLabel htmlFor="eventName">Event name</FieldLabel>
              <Input
                id="eventName"
                type="text"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="purpose">
          {field => (
            <Field>
              <FieldLabel htmlFor="purpose">Purpose</FieldLabel>
              <Textarea
                id="purpose"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="proposedStart">
          {field => (
            <Field>
              <FieldLabel htmlFor="proposedStart">Proposed start</FieldLabel>
              <Input
                id="proposedStart"
                type="datetime-local"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="proposedEnd">
          {field => (
            <Field>
              <FieldLabel htmlFor="proposedEnd">Proposed end</FieldLabel>
              <Input
                id="proposedEnd"
                type="datetime-local"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="expectedAttendance">
          {field => (
            <Field>
              <FieldLabel htmlFor="expectedAttendance">Expected attendance</FieldLabel>
              <Input
                id="expectedAttendance"
                type="number"
                min="1"
                step="1"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <FieldDescription>
          Anything left blank is saved with the draft; you can finish it later.
        </FieldDescription>

        <form.Subscribe selector={s => s.errorMap.onServer}>
          {serverError => (serverError ? <FieldError>{serverError}</FieldError> : null)}
        </form.Subscribe>

        <form.Subscribe selector={s => s.isSubmitting}>
          {isSubmitting => (
            <Field className="w-fit">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save draft"}
              </Button>
            </Field>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
