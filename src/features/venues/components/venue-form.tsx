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
import { Input } from "#/components/ui/input";
import {
  DEFAULT_OPERATING_HOURS,
  LAYOUT_LABELS,
  VENUE_LAYOUTS,
  VenueFormInput,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from "#/features/venues/schema";
import type {
  DayFormValues,
  OperatingHours,
  VenueFormValues,
  VenueValues,
  Weekday,
} from "#/features/venues/schema";

/** The record the form starts from — a saved venue when editing, nothing when creating. */
export type VenueFormInitial = Omit<VenueValues, "id">;

/**
 * Spelled out per day, not built with `Object.fromEntries`: that returns an index signature,
 * which neither satisfies `Record<Weekday, T>` under tsc 7 nor can be converted without an
 * assertion `no-unsafe-type-assertion` refuses.
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
    facilities: (initial?.facilities ?? []).join(", "),
    accessibilityFeatures: (initial?.accessibilityFeatures ?? []).join(", "),
    supportedLayouts: [...(initial?.supportedLayouts ?? [])],
    operatingHours: toFormHours(initial?.operatingHours ?? DEFAULT_OPERATING_HOURS),
  };
}

/**
 * Only the slice of a `form.Field` a text row reads, described structurally so that naming it
 * costs none of TanStack Form's two dozen generics.
 */
interface TextFieldApi {
  name: string;
  state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** What the five plain fields vary by beyond their label; `min`/`step` only capacity uses. */
type TextFieldOptions = Pick<React.ComponentProps<"input">, "type" | "min" | "step"> & {
  description?: string;
};

/**
 * The five single-input fields render an identical row — label, input, optional hint, error — so
 * the row is built once here and each `form.Field` hands its own `field` to the result. The
 * `<form.Field>` stays at the call site so `name` is still checked against the form's own keys,
 * and that name doubles as the input's `id`: both the unit tests and `tests/e2e/venues.test.ts`
 * reach these inputs through the label pointing at it, so the pairing is load-bearing.
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

export function VenueForm({
  initial,
  submitLabel = "Save venue",
  onSave,
}: {
  initial?: VenueFormInitial;
  submitLabel?: string;
  onSave: (values: VenueValues) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: toFormValues(initial),
    validators: { onSubmit: VenueFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        // Validation has already passed, so this parse is the typed handoff, not a second gate.
        await onSave(VenueFormInput.parse(value));
      } catch (error) {
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save this venue. Try again.",
          },
        });
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="name">{textField("Venue name")}</form.Field>
        <form.Field name="location">{textField("Location")}</form.Field>
        <form.Field name="maxCapacity">
          {textField("Maximum capacity", { type: "number", min: "1", step: "1" })}
        </form.Field>
        <form.Field name="facilities">
          {textField("Facilities", {
            description: "Separate entries with commas, e.g. Projector, Stage.",
          })}
        </form.Field>
        <form.Field name="accessibilityFeatures">
          {textField("Accessibility features", {
            description: "Separate entries with commas, e.g. Step-free access, Hearing loop.",
          })}
        </form.Field>

        <form.Field name="supportedLayouts">
          {field => (
            <FieldSet>
              <FieldLegend>Supported room layouts</FieldLegend>
              <div className="grid gap-3 sm:grid-cols-3">
                {VENUE_LAYOUTS.map(layout => (
                  <Field key={layout} orientation="horizontal">
                    <Checkbox
                      id={`layout-${layout}`}
                      checked={field.state.value.includes(layout)}
                      onCheckedChange={checked =>
                        field.handleChange(
                          checked
                            ? [...field.state.value, layout]
                            : field.state.value.filter(value => value !== layout)
                        )
                      }
                    />
                    <FieldLabel htmlFor={`layout-${layout}`}>{LAYOUT_LABELS[layout]}</FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldError errors={field.state.meta.errors} />
            </FieldSet>
          )}
        </form.Field>

        <FieldSet>
          <FieldLegend>Operating hours</FieldLegend>
          <FieldDescription>Untick a day to mark the venue closed.</FieldDescription>
          <div className="grid gap-3">
            {/*
              Without this a sighted user sees a checkbox and two bare time boxes — the labels
              that tell them apart are `sr-only`. Shown only from `sm`, the width at which a row
              actually is these three columns; narrower than that the row stacks and the header
              would point at nothing. `aria-hidden` because those `sr-only` labels already name
              each input, so a second set of column names would only be announced twice.
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

        <form.Subscribe selector={state => state.errorMap.onSubmit}>
          {/* A failed validation arrives as an issue map; only a failed save is a string. */}
          {onSubmitError =>
            typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
          }
        </form.Subscribe>

        <form.Subscribe selector={s => s.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" className="w-fit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
