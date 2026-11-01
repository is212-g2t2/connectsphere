import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";

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
import {
  FormErrorSummary,
  StickyFormActions,
  collectFormErrors,
  focusFirstInvalid,
} from "#/components/ui/form-actions";
import { Input } from "#/components/ui/input";
import {
  DEFAULT_OPERATING_HOURS,
  VenueFormInput,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "#/features/venues/schema";
import type {
  DayFormValues,
  OperatingHours,
  RoomLayout,
  VenueFormValues,
  VenueValues,
  Weekday,
} from "#/features/venues/schema";

/** Start the form from this record. Use a saved venue when editing and nothing when creating. */
export type VenueFormInitial = Omit<VenueValues, "id">;

/**
 * Spell out each day. Do not build with `Object.fromEntries`. That function returns an index
 * signature, which fails `Record<Weekday, T>` under tsc 7. Conversion needs an assertion that
 * `no-unsafe-type-assertion` refuses.
 */
function mapDays<T>(build: (day: Weekday) => T): Record<Weekday, T> {
  return {
    mon: build("mon"),
    tue: build("tue"),
    wed: build("wed"),
    thu: build("thu"),
    fri: build("fri"),
    sat: build("sat"),
    sun: build("sun"),
  };
}

function toFormHours(hours: OperatingHours): Record<Weekday, DayFormValues> {
  return mapDays(day => {
    const range = hours[day];
    return range
      ? { open: true, opens: range.opens, closes: range.closes }
      : { open: false, opens: "", closes: "" };
  });
}

function toFormValues(initial?: VenueFormInitial): VenueFormValues {
  return {
    name: initial?.name ?? "",
    location: initial?.location ?? "",
    maxCapacity: initial ? String(initial.maxCapacity) : "",
    setupMinutes: String(initial?.setupMinutes ?? 0),
    turnaroundMinutes: String(initial?.turnaroundMinutes ?? 0),
    facilities: (initial?.facilities ?? []).join(", "),
    accessibilityFeatures: (initial?.accessibilityFeatures ?? []).join(", "),
    supportedLayouts: [...(initial?.supportedLayouts ?? [])],
    operatingHours: toFormHours(initial?.operatingHours ?? DEFAULT_OPERATING_HOURS),
  };
}

/**
 * Describe only the slice of a `form.Field` that a text row reads. Describe it structurally, so
 * naming it avoids TanStack Form's two dozen generics.
 */
interface TextFieldApi {
  name: string;
  state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** Set the input type, numeric bounds, and optional description for a text field. */
type TextFieldOptions = Pick<React.ComponentProps<"input">, "type" | "min" | "step"> & {
  description?: string;
};

/**
 * The single-input fields render an identical row: label, input, optional hint, and error.
 * Build the row once here. Each `form.Field` hands its own `field` to the result. Keep
 * `<form.Field>` at the call site so `name` still checks against the form keys. That name also
 * serves as the input `id`. Unit tests and `tests/e2e/venues.test.ts` reach these inputs through
 * the label, so the pairing is load-bearing.
 */
function textField(
  label: string,
  { type = "text", min, step, description }: TextFieldOptions = {}
) {
  return (field: TextFieldApi) => (
    <Field>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        type={type}
        min={min}
        step={step}
        value={field.state.value}
        onChange={e => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={field.state.meta.errors.length > 0}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

/** The human label for one submitted field, so the error summary can name it. */
const VENUE_SUMMARY_LABELS: Record<string, string> = {
  name: "Venue name",
  location: "Location",
  maxCapacity: "Maximum capacity",
  setupMinutes: "Setup time (minutes)",
  turnaroundMinutes: "Turnaround time (minutes)",
  facilities: "Facilities",
  accessibilityFeatures: "Accessibility features",
  supportedLayouts: "Supported room layouts",
};

/** The day labels by key, widened so a parsed path can read them without an assertion. */
const DAY_LABELS: Record<string, string> = WEEKDAY_LABELS;

/** Name one submitted venue field by its input and label, including the per-day hours rows. */
function venueFieldTarget(name: string): { fieldId: string; label: string } {
  const hours = /^operatingHours\.([a-z]+)\.(open|opens|closes)$/.exec(name);
  if (hours) {
    const dayLabel = DAY_LABELS[hours[1]] ?? hours[1];
    if (hours[2] === "open") return { fieldId: `open-${hours[1]}`, label: `${dayLabel} open` };
    return { fieldId: `${hours[2]}-${hours[1]}`, label: `${dayLabel} ${hours[2]}` };
  }
  return { fieldId: name, label: VENUE_SUMMARY_LABELS[name] ?? name };
}

/** Tell the caller whether the form is dirty from an effect, so render stays pure. */
function VenueDirtyReporter({
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

export function VenueForm({
  initial,
  layouts,
  submitLabel = "Save venue",
  onSave,
  onDirtyChange,
}: {
  initial?: VenueFormInitial;
  /** The maintained list, from the route loader. New types appear here without a code change. */
  layouts: readonly RoomLayout[];
  submitLabel?: string;
  onSave: (values: VenueValues) => Promise<void>;
  /** Report live whether any field differs from its mount default. Ignore when omitted. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const form = useForm({
    defaultValues: toFormValues(initial),
    validators: { onSubmit: VenueFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        // Validation already passed. This parse is the typed handoff, not a second gate.
        await onSave(VenueFormInput.parse(value));
      } catch (error) {
        // Pass `fields` so the library reads this as a global error and stores `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save this venue. Try again.",
          },
        });
      }
    },
    // On a refused submit, move focus to the first field the schema marked, in form order.
    onSubmitInvalid: ({ formApi }) => {
      focusFirstInvalid(collectFormErrors(formApi.state.fieldMeta, venueFieldTarget));
    },
  });

  const dirtyReporter = onDirtyChange && (
    <form.Subscribe selector={state => state.isDirty}>
      {dirty => <VenueDirtyReporter dirty={dirty} onDirtyChange={onDirtyChange} />}
    </form.Subscribe>
  );

  const errorSummary = (
    <form.Subscribe selector={state => state.fieldMeta}>
      {fieldMeta => <FormErrorSummary errors={collectFormErrors(fieldMeta, venueFieldTarget)} />}
    </form.Subscribe>
  );

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      {dirtyReporter}
      <p className="mb-4 body-sm text-muted-foreground">
        Every field is required unless marked optional.
      </p>
      <FieldGroup>
        <section className="space-y-4" aria-label="Space">
          <div>
            <h3 className="display-h3">Space</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              What the venue is called, where it is, and how many people it holds.
            </p>
          </div>
          <form.Field name="name">{textField("Venue name")}</form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="location">{textField("Location")}</form.Field>
            <form.Field name="maxCapacity">
              {textField("Maximum capacity", { type: "number", min: "1", step: "1" })}
            </form.Field>
          </div>
        </section>

        <section className="space-y-4 border-t border-border pt-6" aria-label="Operations">
          <div>
            <h3 className="display-h3">Operations</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              Buffer time around each booking or hold, in minutes.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="setupMinutes">
              {textField("Setup time (minutes)", {
                type: "number",
                min: "0",
                step: "1",
                description: "Time needed before a booking or hold. Use 0 if none is needed.",
              })}
            </form.Field>
            <form.Field name="turnaroundMinutes">
              {textField("Turnaround time (minutes)", {
                type: "number",
                min: "0",
                step: "1",
                description: "Time needed after a booking or hold. Use 0 if none is needed.",
              })}
            </form.Field>
          </div>
        </section>

        <section
          className="space-y-4 border-t border-border pt-6"
          aria-label="Facilities and access"
        >
          <div>
            <h3 className="display-h3">Facilities and access</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              What the venue offers, and how people with access needs use it.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="facilities">
              {textField("Facilities (optional)", {
                description: "Separate entries with commas, e.g. Projector, Stage.",
              })}
            </form.Field>
            <form.Field name="accessibilityFeatures">
              {textField("Accessibility features (optional)", {
                description: "Separate entries with commas, e.g. Step-free access, Hearing loop.",
              })}
            </form.Field>
          </div>
        </section>

        <section className="space-y-4 border-t border-border pt-6" aria-label="Layouts">
          <div>
            <h3 className="display-h3">Layouts</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              Room arrangements this venue can host.
            </p>
          </div>
          <form.Field name="supportedLayouts">
            {field => (
              <FieldSet>
                <FieldLegend>Supported room layouts (optional)</FieldLegend>
                <div className="grid gap-3 sm:grid-cols-3">
                  {layouts.map(layout => (
                    <Field key={layout.key} orientation="horizontal">
                      <Checkbox
                        id={`layout-${layout.key}`}
                        checked={field.state.value.includes(layout.key)}
                        onCheckedChange={checked =>
                          field.handleChange(
                            checked
                              ? [...field.state.value, layout.key]
                              : field.state.value.filter(value => value !== layout.key)
                          )
                        }
                      />
                      <FieldLabel htmlFor={`layout-${layout.key}`}>{layout.label}</FieldLabel>
                    </Field>
                  ))}
                </div>
                <FieldError errors={field.state.meta.errors} />
              </FieldSet>
            )}
          </form.Field>
        </section>

        <section className="space-y-4 border-t border-border pt-6" aria-label="Hours">
          <div>
            <h3 className="display-h3">Hours</h3>
            <p className="mt-1 body-sm text-muted-foreground">
              When the venue is open. Untick a day to mark the venue closed.
            </p>
          </div>
          <FieldSet>
            <FieldLegend>Operating hours</FieldLegend>
            <div className="grid gap-3">
              {/*
                Without this header, a sighted user sees a checkbox and two bare time boxes. The labels
                that tell them apart are `sr-only`. Show the header only from `sm`, the width where a row
                uses three columns. Below that width the row stacks, and the header would point at nothing.
                Mark it `aria-hidden` because the `sr-only` labels already name each input. A second set of
                column names would announce twice.
              */}
              <div
                aria-hidden="true"
                className="hidden gap-3 eyebrow text-muted-foreground sm:grid sm:grid-cols-[9rem_1fr_1fr]"
              >
                <span>Day</span>
                <span>Opens</span>
                <span>Closes</span>
              </div>
              {WEEKDAYS.map(day => (
                <form.Field key={day} name={`operatingHours.${day}.open`}>
                  {openField => (
                    <div className="grid items-start gap-3 sm:grid-cols-[9rem_1fr_1fr]">
                      <Field orientation="horizontal">
                        <Checkbox
                          id={`open-${day}`}
                          checked={openField.state.value}
                          onCheckedChange={checked => openField.handleChange(checked)}
                        />
                        <FieldLabel htmlFor={`open-${day}`}>{WEEKDAY_LABELS[day]}</FieldLabel>
                      </Field>
                      <form.Field name={`operatingHours.${day}.opens`}>
                        {field => (
                          <Field>
                            <FieldLabel htmlFor={`opens-${day}`} className="sr-only">
                              {WEEKDAY_LABELS[day]} opens
                            </FieldLabel>
                            <Input
                              id={`opens-${day}`}
                              type="time"
                              disabled={!openField.state.value}
                              value={field.state.value}
                              onChange={e => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              aria-invalid={field.state.meta.errors.length > 0}
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name={`operatingHours.${day}.closes`}>
                        {field => (
                          <Field>
                            <FieldLabel htmlFor={`closes-${day}`} className="sr-only">
                              {WEEKDAY_LABELS[day]} closes
                            </FieldLabel>
                            <Input
                              id={`closes-${day}`}
                              type="time"
                              disabled={!openField.state.value}
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
                  )}
                </form.Field>
              ))}
            </div>
          </FieldSet>
        </section>

        <form.Subscribe selector={state => state.errorMap.onSubmit}>
          {/* A failed validation arrives as an issue map; only a failed save is a string. */}
          {onSubmitError =>
            typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
          }
        </form.Subscribe>

        {errorSummary}

        <form.Subscribe selector={state => [state.isSubmitting, state.isDirty]}>
          {([isSubmitting, isDirty]) => (
            <StickyFormActions>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : submitLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting || !isDirty}
                onClick={() => form.reset()}
              >
                Cancel
              </Button>
            </StickyFormActions>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
