import { Fragment, useRef } from "react";
import { standardSchemaValidators, useForm } from "@tanstack/react-form";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import {
  CLARIFICATION_TEXT_MAX,
  ClarificationReplyBodyInput,
  EventRequestDraftFormInput,
  missingRequiredFields,
} from "#/features/event-requests/schema";
import type {
  ClarificationField,
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
  registrationEnabled: false,
  registrationCapacity: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
};

/**
 * The draft fields plus the reply body a clarification reply carries in the same form. The draft
 * schema does not know `replyBody`; its transform drops it on parse.
 */
type EventRequestFormValues = EventRequestDraftFormValues & { replyBody: string };

/** What the caller gets with the parsed values: the reply text and the fields the organiser touched. */
export interface EventRequestFormSubmitContext {
  changedFields: readonly string[];
  replyBody: string;
}

const OPTIONAL_TEXT_FIELDS = [
  ["description", "Description"],
  ["eventType", "Type of event"],
  ["venueRequirements", "Venue requirements"],
  ["roomLayoutPreference", "Room-layout preference"],
  ["accessibilityRequirements", "Accessibility requirements"],
  ["specialArrangements", "Special arrangements"],
] as const;

/** The registration rows vary only by name, label and input type, exactly like the equipment ones. */
const REGISTRATION_FIELDS = [
  {
    name: "registrationCapacity",
    label: "Registration capacity (required)",
    type: "number",
    min: "1",
    step: "1",
  },
  {
    name: "registrationOpensAt",
    label: "Registration opens (required)",
    type: "datetime-local",
  },
  {
    name: "registrationClosesAt",
    label: "Registration closes (required)",
    type: "datetime-local",
  },
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
    registrationEnabled: initial.registrationEnabled,
    registrationCapacity:
      initial.registrationCapacity === undefined ? "" : String(initial.registrationCapacity),
    registrationOpensAt: initial.registrationOpensAt ?? "",
    registrationClosesAt: initial.registrationClosesAt ?? "",
  };
}

function toDefaultFormValues(initial?: EventRequestDraftValues): EventRequestFormValues {
  return { ...(initial ? toFormValues(initial) : DEFAULT_VALUES), replyBody: "" };
}

/**
 * A form-level `onSubmit` error is the schema's issue map after a failed validation or the
 * server's message after a failed save; only the latter is a string.
 */
function toFormError(error: unknown): string | undefined {
  return typeof error === "string" ? error : undefined;
}

/**
 * The top-level names of every field the organiser has changed since the form loaded. A nested name
 * (`proposedDates[0].start`) is folded onto its parent, because the server records one amendment
 * per clarification field, not per input. Untouched fields are never echoed back, so a reply to a
 * second question cannot resend the page-load snapshot and revert the first reply's amendment.
 */
function changedFieldNames(
  fieldMeta: Record<string, { isDefaultValue?: boolean } | undefined>
): string[] {
  const names = new Set<string>();
  for (const [name, meta] of Object.entries(fieldMeta)) {
    if (meta?.isDefaultValue === false) names.add(name.replace(/\[.*$/, ""));
  }
  return [...names];
}

/** The top-level field each label `missingRequiredFields` returns belongs to. */
const MISSING_FIELD_KEYS: Partial<Record<string, string>> = {
  "Event name": "eventName",
  Purpose: "purpose",
  "Expected attendance": "expectedAttendance",
  "Proposed dates and times": "proposedDates",
  "Equipment requirements": "equipmentRequirements",
};

/**
 * Where a missing required field shows: the scalar's own name, or the first incomplete row of an
 * array. The row index is read off the form value, because the parsed draft has already dropped the
 * rows the organiser left entirely blank.
 */
function missingFieldPath(key: string, value: EventRequestFormValues): string {
  if (key === "proposedDates") {
    const index = value.proposedDates.findIndex(date => date.start === "" || date.end === "");
    return `proposedDates[${Math.max(index, 0)}].start`;
  }
  if (key === "equipmentRequirements") {
    const index = value.equipmentRequirements.findIndex(
      line => line.type === "" || line.quantity === ""
    );
    return `equipmentRequirements[${Math.max(index, 0)}].type`;
  }
  return key;
}

/**
 * A submission needs the PTR-10 fields complete; a draft does not, so the form shape maps a blank
 * permitted field to an absent one and the schema passes it. In reply mode that would let a cleared
 * required field reach the server, which answers with its form-level sentence above the action row.
 * This turns each missing field into a field-level error, at the control that owns it, for the
 * fields the Coordinator permitted. Locked fields are complete by construction and skipped.
 */
function missingFieldErrors(
  value: EventRequestFormValues,
  parsed: EventRequestDraftValues,
  editable: (field: string) => boolean
): Record<string, { message: string }[]> {
  const fields: Record<string, { message: string }[]> = {};

  for (const label of missingRequiredFields(parsed)) {
    const key = MISSING_FIELD_KEYS[label];
    if (key === undefined || !editable(key)) continue;
    fields[missingFieldPath(key, value)] = [{ message: `${label} is required` }];
  }

  return fields;
}

/**
 * The form-level validator. The draft schema is a standard schema, so the library maps each issue
 * path (`proposedDates[0].end`) onto the field the form should show it at. The schema validates the
 * draft fields; the reply body is validated at its own field, so this widens the form validator to
 * accept a value carrying `replyBody` without restating the schema.
 *
 * In reply mode the schema alone is too lenient: it accepts a cleared permitted required field
 * because absence is valid while drafting. `missingFieldErrors` adds those omissions back as field
 * errors, merged so the schema's own issues stay put.
 */
function draftValidator({
  value,
  editable,
  replyMode,
}: {
  value: EventRequestFormValues;
  editable: (field: string) => boolean;
  replyMode: boolean;
}) {
  const result = standardSchemaValidators.validate<"form">(
    { value, validationSource: "form" },
    EventRequestDraftFormInput
  );
  if (!replyMode) return result;

  const parsed = EventRequestDraftFormInput.safeParse(value);
  if (!parsed.success) return result;

  const fields = missingFieldErrors(value, parsed.data, editable);
  if (Object.keys(fields).length === 0) return result;

  return { form: result?.form ?? {}, fields: { ...result?.fields, ...fields } };
}

export function EventRequestForm({
  initialValues,
  onSave,
  onSubmitRequest,
  editableFields,
  saveLabel = "Save draft",
  busyLabel = "Saving…",
  disabled = false,
  replyBody,
  idPrefix,
}: {
  initialValues?: EventRequestDraftValues;
  onSave: (
    values: EventRequestDraftValues,
    context: EventRequestFormSubmitContext
  ) => Promise<void>;
  /** Absent while the caller has nowhere to submit to yet; the control is dropped with it. */
  onSubmitRequest?: (
    values: EventRequestDraftValues,
    context: EventRequestFormSubmitContext
  ) => Promise<void>;
  /** When replying to a clarification, every other control remains visible but read-only. */
  editableFields?: readonly string[];
  saveLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  /** When replying, the body is a required field of this same form, labelled as given. */
  replyBody?: { label: string };
  idPrefix?: string;
}) {
  /**
   * Which control is submitting. A ref rather than state because the click and the submit are two
   * events the browser fires back to back — the intent has to be readable by the handler this
   * render already closed over.
   */
  const intent = useRef<"save" | "submit">("save");
  const replyMode = editableFields !== undefined;
  const editable = (field: string) => !editableFields || editableFields.includes(field);
  const inputId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);

  const form = useForm({
    defaultValues: toDefaultFormValues(initialValues),
    validators: {
      onSubmit: ({ value }: { value: EventRequestFormValues }) =>
        draftValidator({ value, editable, replyMode }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        const values = EventRequestDraftFormInput.parse(value);
        const context: EventRequestFormSubmitContext = {
          changedFields: changedFieldNames(formApi.state.fieldMeta),
          replyBody: value.replyBody,
        };
        await (intent.current === "submit" && onSubmitRequest
          ? onSubmitRequest(values, context)
          : onSave(values, context));
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

  const renderEventName = () => (
    <form.Field name="eventName">
      {field => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={inputId(field.name)}>Event name (required)</FieldLabel>
          <Input
            id={inputId(field.name)}
            required
            disabled={!editable("eventName")}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={event => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  );

  const renderPurpose = () => (
    <form.Field name="purpose">
      {field => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={inputId(field.name)}>Purpose (required)</FieldLabel>
          <Textarea
            id={inputId(field.name)}
            required
            disabled={!editable("purpose")}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={event => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  );

  const renderProposedDates = () => (
    <form.Field name="proposedDates" mode="array">
      {field => (
        <div className="border-t border-border pt-6">
          <FieldSet>
            <FieldLegend>Proposed dates and times (required)</FieldLegend>
            <FieldDescription>
              Enter each proposed window in local time. An end must be later than its start.
            </FieldDescription>
            {field.state.value.map((date, index) => (
              <div key={date.key} className="grid gap-4 sm:grid-cols-2">
                {(["start", "end"] as const).map(boundary => (
                  <form.Field key={boundary} name={`proposedDates[${index}].${boundary}`}>
                    {boundaryField => (
                      <Field data-invalid={boundaryField.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={inputId(boundaryField.name)}>
                          Proposed {boundary} {index + 1} (required)
                        </FieldLabel>
                        <Input
                          id={inputId(boundaryField.name)}
                          type="datetime-local"
                          required
                          disabled={!editable("proposedDates")}
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
                    disabled={!editable("proposedDates")}
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
              disabled={!editable("proposedDates")}
              onClick={() => field.pushValue({ key: crypto.randomUUID(), start: "", end: "" })}
            >
              Add proposed date
            </Button>
          </FieldSet>
        </div>
      )}
    </form.Field>
  );

  const renderExpectedAttendance = () => (
    <form.Field name="expectedAttendance">
      {field => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={inputId(field.name)}>Expected attendance (required)</FieldLabel>
          <Input
            id={inputId(field.name)}
            type="number"
            min="1"
            step="1"
            required
            disabled={!editable("expectedAttendance")}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={event => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  );

  const renderRegistration = () => (
    <form.Field name="registrationEnabled">
      {field => (
        <section
          className="space-y-6 border-t border-border pt-6"
          aria-label="Attendee registration"
        >
          <div className="space-y-2">
            {!replyMode && <h3 className="display-h3">Attendee registration</h3>}
            <Field orientation="horizontal">
              <Checkbox
                id={inputId(field.name)}
                checked={field.state.value}
                disabled={!editable("attendeeRegistration")}
                onCheckedChange={checked => field.handleChange(checked)}
              />
              <FieldLabel htmlFor={inputId(field.name)}>Require attendee registration</FieldLabel>
            </Field>
            <FieldDescription>
              Registered attendees sign up between these times, up to this capacity. Turning
              registration off saves no terms.
            </FieldDescription>
          </div>

          {field.state.value && (
            <div className="grid gap-4 sm:grid-cols-3">
              {REGISTRATION_FIELDS.map(({ name, label, ...input }) => (
                <form.Field key={name} name={name}>
                  {registrationField => (
                    <Field data-invalid={registrationField.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor={inputId(registrationField.name)}>{label}</FieldLabel>
                      <Input
                        id={inputId(registrationField.name)}
                        required
                        disabled={!editable("attendeeRegistration")}
                        {...input}
                        value={registrationField.state.value}
                        onBlur={registrationField.handleBlur}
                        onChange={event => registrationField.handleChange(event.target.value)}
                        aria-invalid={registrationField.state.meta.errors.length > 0}
                      />
                      <FieldError errors={registrationField.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              ))}
            </div>
          )}
        </section>
      )}
    </form.Field>
  );

  const renderOptionalText = (name: (typeof OPTIONAL_TEXT_FIELDS)[number][0]) => (
    <form.Field name={name}>
      {field => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={inputId(field.name)}>
            {OPTIONAL_TEXT_FIELDS.find(([key]) => key === name)?.[1]} (optional)
          </FieldLabel>
          {name === "eventType" ? (
            <Input
              id={inputId(field.name)}
              disabled={!editable(name)}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={event => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
          ) : (
            <Textarea
              id={inputId(field.name)}
              disabled={!editable(name)}
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
  );

  const renderEquipment = () => (
    <form.Field name="equipmentRequirements" mode="array">
      {field => (
        <div className="border-t border-border pt-6">
          <FieldSet>
            <FieldLegend>Equipment requirements (optional)</FieldLegend>
            {field.state.value.map((equipment, index) => (
              <div key={equipment.key} className="grid gap-4 sm:grid-cols-2">
                {(["type", "quantity"] as const).map(part => (
                  <form.Field key={part} name={`equipmentRequirements[${index}].${part}`}>
                    {partField => (
                      <Field data-invalid={partField.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={inputId(partField.name)}>
                          {part === "type" ? "Equipment type" : "Quantity"} {index + 1}
                        </FieldLabel>
                        <Input
                          id={inputId(partField.name)}
                          {...(part === "quantity" ? { type: "number", min: "1", step: "1" } : {})}
                          value={partField.state.value}
                          disabled={!editable("equipmentRequirements")}
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
                  disabled={!editable("equipmentRequirements")}
                  onClick={() => field.removeValue(index)}
                >
                  Remove equipment {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!editable("equipmentRequirements")}
              onClick={() => field.pushValue({ key: crypto.randomUUID(), type: "", quantity: "" })}
            >
              Add equipment
            </Button>
          </FieldSet>
        </div>
      )}
    </form.Field>
  );

  /**
   * The form's own fields in the order the draft form presents them. Reply mode splits this list by
   * whether the Coordinator permitted each field, so the amendable ones lead and the rest fold away.
   */
  const canonicalFields: { key: ClarificationField; render: () => React.ReactNode }[] = [
    { key: "eventName", render: renderEventName },
    { key: "purpose", render: renderPurpose },
    { key: "proposedDates", render: renderProposedDates },
    { key: "expectedAttendance", render: renderExpectedAttendance },
    { key: "attendeeRegistration", render: renderRegistration },
    { key: "description", render: () => renderOptionalText("description") },
    { key: "eventType", render: () => renderOptionalText("eventType") },
    { key: "venueRequirements", render: () => renderOptionalText("venueRequirements") },
    { key: "roomLayoutPreference", render: () => renderOptionalText("roomLayoutPreference") },
    {
      key: "accessibilityRequirements",
      render: () => renderOptionalText("accessibilityRequirements"),
    },
    { key: "specialArrangements", render: () => renderOptionalText("specialArrangements") },
    { key: "equipmentRequirements", render: renderEquipment },
  ];

  const replyBodyLabel = replyBody?.label;
  const replyBodyField = replyBodyLabel !== undefined && (
    <form.Field
      name="replyBody"
      validators={{
        onSubmit: ({ value }) => {
          const parsed = ClarificationReplyBodyInput.safeParse(value);
          return parsed.success ? undefined : { message: parsed.error.issues[0].message };
        },
      }}
    >
      {field => (
        <Field data-invalid={field.state.meta.errors.length > 0}>
          <FieldLabel htmlFor={inputId("replyBody")}>{replyBodyLabel} (required)</FieldLabel>
          <Textarea
            id={inputId("replyBody")}
            className="mt-2"
            rows={4}
            required
            maxLength={CLARIFICATION_TEXT_MAX}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={event => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors} />
        </Field>
      )}
    </form.Field>
  );

  const formError = (
    <form.Subscribe selector={state => state.errorMap.onSubmit}>
      {onSubmitError => {
        const message = toFormError(onSubmitError);
        return message ? <FieldError>{message}</FieldError> : null;
      }}
    </form.Subscribe>
  );

  const actionRow = (
    <form.Subscribe selector={state => state.isSubmitting}>
      {isSubmitting => (
        <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Button
            type="submit"
            disabled={isSubmitting || disabled}
            onClick={() => {
              intent.current = "save";
            }}
          >
            {isSubmitting && intent.current === "save" ? busyLabel : saveLabel}
          </Button>
          {onSubmitRequest && (
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting || disabled}
              onClick={() => {
                intent.current = "submit";
                void form.handleSubmit();
              }}
            >
              {isSubmitting && intent.current === "submit" ? "Submitting…" : "Submit request"}
            </Button>
          )}
        </div>
      )}
    </form.Subscribe>
  );

  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void form.handleSubmit();
  };

  if (replyMode) {
    return (
      <form noValidate onSubmit={submitForm}>
        {editableFields.length > 0 && (
          <p className="mb-6 body-sm text-muted-foreground">
            Only the fields selected by the Coordinator can be changed. Required values must remain
            complete.
          </p>
        )}

        <FieldGroup>
          {replyBodyField}
          {canonicalFields
            .filter(field => editable(field.key))
            .map(field => (
              <Fragment key={field.key}>{field.render()}</Fragment>
            ))}
          {formError}
          {actionRow}
          <details className="border-t border-border pt-6">
            <summary className="cursor-pointer font-medium">
              Other request details (read-only)
            </summary>
            <div className="mt-6 space-y-7">
              {canonicalFields
                .filter(field => !editable(field.key))
                .map(field => (
                  <Fragment key={field.key}>{field.render()}</Fragment>
                ))}
            </div>
          </details>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={submitForm}>
      <p className="mb-6 body-sm text-muted-foreground">
        Fields marked required must be completed. Anything left blank is saved with the draft, so
        you can finish it later.
      </p>

      <FieldGroup>
        {renderEventName()}
        {renderPurpose()}
        {renderProposedDates()}
        {renderExpectedAttendance()}
        {renderRegistration()}

        <section
          className="space-y-6 border-t border-border pt-6"
          aria-label="Optional requirements"
        >
          <h3 className="display-h3">Additional requirements</h3>
          {OPTIONAL_TEXT_FIELDS.map(([name]) => (
            <Fragment key={name}>{renderOptionalText(name)}</Fragment>
          ))}
        </section>

        {renderEquipment()}

        {formError}

        {actionRow}
      </FieldGroup>
    </form>
  );
}
