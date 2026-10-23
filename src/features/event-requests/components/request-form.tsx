import { Fragment, useEffect, useRef, useState } from "react";
import { standardSchemaValidators, useForm } from "@tanstack/react-form";
import { Trash2Icon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
  CLARIFICATION_TEXT_MAX,
  ClarificationReplyBodyInput,
  EventRequestDraftFormInput,
  LISTED_DETAIL_FIELDS,
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
 * Draft fields with the clarification reply body. The draft schema does not include `replyBody`,
 * so its transform drops that field when it parses the draft.
 */
type EventRequestFormValues = EventRequestDraftFormValues & { replyBody: string };

/** Parsed values, reply text, and the fields the Organiser changed. */
export interface EventRequestFormSubmitContext {
  changedFields: readonly string[];
  replyBody: string;
}

/**
 * PTR-155: these details are required at submission, but a draft may leave them blank.
 * `control` picks the input; the option lists are the vocabulary the Coordinator reads.
 */
const EVENT_TYPE_OPTIONS = ["Workshop", "Meeting", "Training", "Social", "Conference"] as const;

const ROOM_LAYOUT_OPTIONS = [
  "Theatre",
  "Classroom",
  "Boardroom",
  "Banquet",
  "Exhibition",
  "U-shape",
  "Cabaret",
] as const;

const VENUE_REQUIREMENT_OPTIONS = [
  "Power outlets",
  "Natural light",
  "Air conditioning",
  "Projector and screen",
  "Sound system",
  "Parking",
  "Kitchen access",
  "Outdoor space",
] as const;

const ACCESSIBILITY_OPTIONS = [
  "Step-free access",
  "Accessible toilet",
  "Wheelchair space",
  "Hearing loop",
  "Quiet room",
  "Sign-language interpreter",
] as const;

const VALUE_SEPARATOR = "; ";

type TextFieldName =
  | "eventType"
  | "description"
  | "venueRequirements"
  | "roomLayoutPreference"
  | "accessibilityRequirements"
  | "specialArrangements";

interface TextField {
  name: TextFieldName;
  label: string;
  required: boolean;
  control: "textarea" | "select" | "checkboxes";
  options?: readonly string[];
  /** The option that clears every other choice. */
  exclusiveOption?: string;
  description?: string;
  rows?: number;
}

type TextFieldShape = Omit<TextField, "name">;

const TEXT_FIELDS = {
  eventType: {
    label: "Type of event",
    required: false,
    control: "select",
    options: EVENT_TYPE_OPTIONS,
  },
  description: {
    label: "Description",
    required: true,
    control: "textarea",
  },
  venueRequirements: {
    label: "Venue requirements",
    required: true,
    control: "checkboxes",
    options: VENUE_REQUIREMENT_OPTIONS,
    exclusiveOption: "No special requirements",
    description: "Choose every facility the event needs.",
  },
  roomLayoutPreference: {
    label: "Room-layout preference",
    required: true,
    control: "select",
    options: ROOM_LAYOUT_OPTIONS,
  },
  accessibilityRequirements: {
    label: "Accessibility requirements",
    required: true,
    control: "checkboxes",
    options: ACCESSIBILITY_OPTIONS,
    exclusiveOption: "None",
    description: "Choose None if there are no accessibility needs.",
  },
  specialArrangements: {
    label: "Special arrangements",
    required: false,
    control: "textarea",
    rows: 2,
  },
} as const satisfies Record<TextFieldName, TextFieldShape>;

/** Attach the key as the field name, so a caller cannot name a field outside the table. */
function textField(name: TextFieldName): TextField {
  return { name, ...TEXT_FIELDS[name] };
}

/** A checkbox group whose value stays one string, joined with `VALUE_SEPARATOR`. */
function CheckboxGroupControl({
  id,
  label,
  value,
  options,
  exclusiveOption,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  exclusiveOption?: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const parts = value === "" ? [] : value.split(VALUE_SEPARATOR);
  const known = new Set<string>(options);
  const selected = parts.filter(part => known.has(part) || part === exclusiveOption);
  const storedOther = parts
    .filter(part => !known.has(part) && part !== exclusiveOption)
    .join(VALUE_SEPARATOR);
  const [otherOpen, setOtherOpen] = useState(storedOther !== "");
  const [otherText, setOtherText] = useState(storedOther);

  const commit = (nextSelected: readonly string[], nextOther: string) => {
    const trimmed = nextOther.trim();
    const next: string[] = [];
    // Keep the stored order for values that survive; append newly chosen options.
    for (const part of parts) {
      if (part === exclusiveOption || known.has(part)) {
        if (nextSelected.includes(part) && !next.includes(part)) next.push(part);
      } else if (trimmed !== "" && !next.includes(trimmed)) {
        next.push(trimmed);
      }
    }
    for (const option of nextSelected) {
      if (!next.includes(option)) next.push(option);
    }
    if (trimmed !== "" && !next.includes(trimmed)) next.push(trimmed);
    onChange(next.join(VALUE_SEPARATOR));
  };

  const toggle = (option: string, checked: boolean) => {
    if (!checked) {
      commit(
        selected.filter(item => item !== option),
        otherText
      );
      return;
    }
    if (option === exclusiveOption) {
      setOtherOpen(false);
      setOtherText("");
      onChange(option);
      return;
    }
    commit([...selected.filter(item => item !== exclusiveOption), option], otherText);
  };

  const toggleOther = (checked: boolean) => {
    setOtherOpen(checked);
    if (!checked) {
      setOtherText("");
      commit(
        selected.filter(item => item !== exclusiveOption),
        ""
      );
      return;
    }
    if (exclusiveOption !== undefined && selected.includes(exclusiveOption)) {
      commit([], "");
    }
  };

  const changeOther = (text: string) => {
    setOtherText(text);
    commit(
      selected.filter(item => item !== exclusiveOption),
      text
    );
  };

  return (
    <div data-slot="checkbox-group" className="grid gap-3 sm:grid-cols-2">
      {options.map((option, index) => {
        const optionId = `${id}-option-${index}`;
        return (
          <Field key={option} orientation="horizontal">
            <Checkbox
              id={optionId}
              checked={selected.includes(option)}
              disabled={disabled}
              onCheckedChange={checked => toggle(option, checked)}
            />
            <FieldLabel htmlFor={optionId}>{option}</FieldLabel>
          </Field>
        );
      })}
      {exclusiveOption !== undefined && (
        <Field orientation="horizontal">
          <Checkbox
            id={`${id}-none`}
            checked={selected.includes(exclusiveOption)}
            disabled={disabled}
            onCheckedChange={checked => toggle(exclusiveOption, checked)}
          />
          <FieldLabel htmlFor={`${id}-none`}>{exclusiveOption}</FieldLabel>
        </Field>
      )}
      <Field orientation="horizontal">
        <Checkbox
          id={`${id}-other`}
          checked={otherOpen || otherText !== ""}
          disabled={disabled}
          onCheckedChange={checked => toggleOther(checked)}
        />
        <FieldLabel htmlFor={`${id}-other`}>Other</FieldLabel>
      </Field>
      {otherOpen && (
        <Textarea
          id={`${id}-other-text`}
          className="min-h-0 sm:col-span-2"
          rows={2}
          aria-label={`${label}: other`}
          placeholder="Describe it"
          value={otherText}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={event => changeOther(event.target.value)}
          onBlur={() => {
            if (otherText.trim() === "") {
              setOtherOpen(false);
              commit(selected, "");
            }
          }}
        />
      )}
    </div>
  );
}

/** A single-choice select that keeps free text through an "Other" item. */
function SelectControl({
  id,
  label,
  value,
  options,
  optional,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  optional: boolean;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const isOption = value === "" || options.includes(value);
  const [otherOpen, setOtherOpen] = useState(!isOption);
  const [otherText, setOtherText] = useState(isOption ? "" : value);

  const handleValueChange = (next: string | null) => {
    if (next === "__other") {
      // Re-selecting the open Other row must not erase the text it holds.
      if (otherOpen) return;
      setOtherOpen(true);
      setOtherText("");
      onChange("");
      return;
    }
    setOtherOpen(false);
    onChange(next === null ? "" : next);
  };

  const display = otherOpen ? "Other" : value === "" ? (optional ? "Not specified" : null) : value;

  return (
    <>
      <Select
        value={otherOpen ? "__other" : value === "" ? null : value}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
          <SelectValue placeholder={optional ? "Not specified" : "Choose one"}>
            {display}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          <SelectItem value="__other">Other</SelectItem>
          <SelectItem value={null}>{optional ? "Not specified" : "Choose one"}</SelectItem>
        </SelectContent>
      </Select>
      {otherOpen && (
        <Input
          className="mt-2"
          aria-label={`${label}: other`}
          placeholder="Type the value"
          value={otherText}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={event => {
            setOtherText(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={() => {
            if (otherText.trim() === "") {
              setOtherOpen(false);
              onChange("");
            }
          }}
        />
      )}
    </>
  );
}

/** Registration rows vary by name, label, and input type, like the equipment rows. */
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
 * Map stored values to the form shape. Inputs cannot preserve some stored values, such as numbers,
 * absent quantities, or a missing date row. This mapping only goes from stored data to the form.
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
 * A form-level `onSubmit` error is either the schema's issue map or the server's save message.
 * Only the save message is a string.
 */
function toFormError(error: unknown): string | undefined {
  return typeof error === "string" ? error : undefined;
}

/**
 * Return the top-level names of fields the Organiser changed after the form loaded. Fold nested
 * names such as `proposedDates[0].start` into their parent. The server records one amendment per
 * clarification field, not per input. Do not send untouched fields; a reply to a second question
 * must not restore the page-load snapshot over the first reply's changes.
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

/** Tell the caller whether the form is dirty from an effect, so render stays pure. */
function DirtyReporter({
  dirty,
  onDirtyChange,
}: {
  dirty: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  return null;
}

/** The top-level field for each label `missingRequiredFields` returns. */
const MISSING_FIELD_KEYS: Partial<Record<string, string>> = {
  "Event name": "eventName",
  Purpose: "purpose",
  "Expected attendance": "expectedAttendance",
  "Proposed dates and times": "proposedDates",
  "Equipment requirements": "equipmentRequirements",
};

/**
 * Return where to show a missing-field error: the scalar field or the first incomplete array row.
 * Read the row index from the form value because the parsed draft drops fully blank rows.
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
 * PTR-10 fields must be complete on submit, but drafts allow blank fields. The form maps a blank
 * field to absent, so the draft schema accepts it. A reply or update must not send a cleared
 * required field to the server. Show an error at each editable field instead. Skip locked fields;
 * they are complete by construction.
 */
function missingFieldErrors(
  value: EventRequestFormValues,
  parsed: EventRequestDraftValues,
  editable: (field: string) => boolean,
  replyMode: boolean
): Record<string, { message: string }[]> {
  const fields: Record<string, { message: string }[]> = {};

  for (const label of missingRequiredFields(parsed)) {
    const key = MISSING_FIELD_KEYS[label];
    if (key === undefined || !editable(key)) continue;
    fields[missingFieldPath(key, value)] = [{ message: `${label} is required` }];
  }

  // A reply must not clear a listed detail that the Coordinator permitted. A field the
  // Coordinator did not ask for may stay blank on a row created before PTR-155.
  if (replyMode) {
    for (const [key, label] of LISTED_DETAIL_FIELDS) {
      if (!editable(key) || parsed[key].trim() !== "") continue;
      fields[missingFieldPath(key, value)] = [{ message: `${label} is required` }];
    }
  }

  return fields;
}

/**
 * Validate the form with the draft schema. The library maps each issue path, such as
 * `proposedDates[0].end`, to its field. Validate the reply body at its own field, so this validator
 * accepts `replyBody` without repeating the draft schema.
 *
 * A reply or event update must keep the record complete. The draft schema accepts a cleared
 * required field because drafts allow absence. `missingFieldErrors` adds those omissions as field
 * errors and keeps the schema's own issues.
 */
function draftValidator({
  value,
  editable,
  requireComplete,
  replyMode,
}: {
  value: EventRequestFormValues;
  editable: (field: string) => boolean;
  requireComplete: boolean;
  replyMode: boolean;
}) {
  const result = standardSchemaValidators.validate<"form">(
    { value, validationSource: "form" },
    EventRequestDraftFormInput
  );
  if (!requireComplete) return result;

  const parsed = EventRequestDraftFormInput.safeParse(value);
  if (!parsed.success) return result;

  const fields = missingFieldErrors(value, parsed.data, editable, replyMode);
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
  requireComplete = false,
  onDirtyChange,
}: {
  initialValues?: EventRequestDraftValues;
  onSave: (
    values: EventRequestDraftValues,
    context: EventRequestFormSubmitContext
  ) => Promise<void>;
  /** Omit this while the caller has nowhere to submit to. The submit control drops out with it. */
  onSubmitRequest?: (
    values: EventRequestDraftValues,
    context: EventRequestFormSubmitContext
  ) => Promise<void>;
  /** When replying to a clarification, other controls stay visible but read-only. */
  editableFields?: readonly string[];
  saveLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  /** When replying, the body is a required field of this same form, labelled as given. */
  replyBody?: { label: string };
  idPrefix?: string;
  /**
   * PTR-22: The record is submitted, so reject a blank required field at its control. Reply mode implies this check.
   */
  requireComplete?: boolean;
  /** Report live whether any field differs from its mount default. Ignore when omitted. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  /**
   * The submitting control. Use a ref because the browser fires click and submit back to back.
   * The handler reads the current intent from the ref.
   */
  const intent = useRef<"save" | "submit">("save");
  const replyMode = editableFields !== undefined;
  const mustBeComplete = replyMode || requireComplete;
  const editable = (field: string) => !editableFields || editableFields.includes(field);
  const inputId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);

  // Keep these values for this mount. `isDefaultValue` compares against them; rebuilding them after
  // a parent render would mark untouched fields as changed. Remount with a new `key` to load new values.
  const [defaultValues] = useState(() => toDefaultFormValues(initialValues));
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: ({ value }: { value: EventRequestFormValues }) =>
        draftValidator({ value, editable, requireComplete: mustBeComplete, replyMode }),
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
        // `fields` marks this as a global error and stores `form` verbatim.
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
              className="self-start"
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

  const renderTextField = (metadata: TextField) => (
    <form.Field name={metadata.name}>
      {field => {
        const id = inputId(field.name);
        const invalid = field.state.meta.errors.length > 0;
        const label = `${metadata.label} (${metadata.required ? "required" : "optional"})`;
        const description = metadata.description !== undefined && (
          <FieldDescription>{metadata.description}</FieldDescription>
        );

        if (metadata.control === "checkboxes") {
          const describedBy = [
            metadata.description !== undefined ? `${id}-description` : null,
            invalid ? `${id}-error` : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <FieldSet data-invalid={invalid} aria-describedby={describedBy || undefined}>
              <FieldLegend>{label}</FieldLegend>
              {metadata.description !== undefined && (
                <FieldDescription id={`${id}-description`}>{metadata.description}</FieldDescription>
              )}
              <CheckboxGroupControl
                id={id}
                label={metadata.label}
                value={field.state.value}
                options={metadata.options ?? []}
                exclusiveOption={metadata.exclusiveOption}
                disabled={!editable(field.name)}
                invalid={invalid}
                onChange={value => field.handleChange(value)}
              />
              <FieldError id={`${id}-error`} errors={field.state.meta.errors} />
            </FieldSet>
          );
        }

        return (
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {metadata.control === "select" ? (
              <SelectControl
                id={id}
                label={metadata.label}
                value={field.state.value}
                options={metadata.options ?? []}
                optional={!metadata.required}
                disabled={!editable(field.name)}
                invalid={invalid}
                onChange={value => field.handleChange(value)}
              />
            ) : (
              <Textarea
                id={id}
                rows={metadata.rows ?? 3}
                required={metadata.required}
                disabled={!editable(field.name)}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.target.value)}
                aria-invalid={invalid}
              />
            )}
            {description}
            <FieldError errors={field.state.meta.errors} />
          </Field>
        );
      }}
    </form.Field>
  );

  const renderEquipment = () => (
    <form.Field name="equipmentRequirements" mode="array">
      {field => (
        <div className="border-t border-border pt-6">
          <FieldSet>
            <FieldLegend>Equipment requirements (optional)</FieldLegend>
            {field.state.value.map((equipment, index) => (
              <div key={equipment.key} className="grid grid-cols-[1fr_96px_auto] items-end gap-3">
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
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Remove equipment ${index + 1}`}
                  disabled={!editable("equipmentRequirements")}
                  onClick={() => field.removeValue(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
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
   * The form fields in draft order. Reply mode splits them by Coordinator permission, so editable
   * fields appear first and the others stay hidden.
   */
  const canonicalFields: { key: ClarificationField; render: () => React.ReactNode }[] = [
    { key: "eventName", render: renderEventName },
    { key: "purpose", render: renderPurpose },
    { key: "eventType", render: () => renderTextField(textField("eventType")) },
    { key: "expectedAttendance", render: renderExpectedAttendance },
    { key: "description", render: () => renderTextField(textField("description")) },
    { key: "proposedDates", render: renderProposedDates },
    {
      key: "venueRequirements",
      render: () => renderTextField(textField("venueRequirements")),
    },
    {
      key: "roomLayoutPreference",
      render: () => renderTextField(textField("roomLayoutPreference")),
    },
    {
      key: "accessibilityRequirements",
      render: () => renderTextField(textField("accessibilityRequirements")),
    },
    {
      key: "specialArrangements",
      render: () => renderTextField(textField("specialArrangements")),
    },
    { key: "attendeeRegistration", render: renderRegistration },
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

  const dirtyReporter = onDirtyChange && (
    <form.Subscribe selector={state => changedFieldNames(state.fieldMeta).length > 0}>
      {dirty => <DirtyReporter dirty={dirty} onDirtyChange={onDirtyChange} />}
    </form.Subscribe>
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
        {dirtyReporter}
        {editableFields.length > 0 && (
          <p className="mb-4 body-sm text-muted-foreground">
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
      {dirtyReporter}
      <p className="mb-4 body-sm text-muted-foreground">
        {mustBeComplete
          ? "Fields marked required must stay complete."
          : "Fields marked required must be completed before you submit. A draft can keep them blank; submitting needs them filled."}
      </p>

      <FieldGroup>
        <section className="space-y-6 border-t border-border pt-6" aria-label="Event details">
          <div>
            <h3 className="display-h3">Event details</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              What the event is, who it is for, and how many people come.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="md:col-span-2">{renderEventName()}</div>
            <div className="md:col-span-2">{renderPurpose()}</div>
            <div>{renderTextField(textField("eventType"))}</div>
            <div>{renderExpectedAttendance()}</div>
            <div className="md:col-span-2">{renderTextField(textField("description"))}</div>
          </div>
        </section>

        {renderProposedDates()}

        <section className="space-y-6 border-t border-border pt-6" aria-label="Requirements">
          <div>
            <h3 className="display-h3">Requirements</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              How the room should be set up, and what it must provide.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="md:col-span-2">{renderTextField(textField("venueRequirements"))}</div>
            <div>{renderTextField(textField("roomLayoutPreference"))}</div>
            <div>{renderTextField(textField("specialArrangements"))}</div>
            <div className="md:col-span-2">
              {renderTextField(textField("accessibilityRequirements"))}
            </div>
          </div>
        </section>

        {renderRegistration()}

        {renderEquipment()}

        {formError}

        {actionRow}
      </FieldGroup>
    </form>
  );
}
