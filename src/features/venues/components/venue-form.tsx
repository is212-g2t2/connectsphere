import { useForm } from "@tanstack/react-form";
import { useState } from "react";

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
  VENUE_LAYOUTS,
  VenueInput,
  WEEKDAYS,
} from "#/features/venues/schema";
import type { OperatingHours, VenueLayout, VenueValues, Weekday } from "#/features/venues/schema";

export const LAYOUT_LABELS: Record<VenueLayout, string> = {
  theatre: "Theatre",
  classroom: "Classroom",
  boardroom: "Boardroom",
  banquet: "Banquet",
  exhibition: "Exhibition",
  other: "Other",
};

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

interface DayFormValues {
  open: boolean;
  opens: string;
  closes: string;
}

/** What the inputs hold: strings and booleans, converted to `VenueValues` only on submit. */
interface VenueFormValues {
  name: string;
  location: string;
  maxCapacity: string;
  facilities: string;
  accessibilityFeatures: string;
  supportedLayouts: VenueLayout[];
  operatingHours: Record<Weekday, DayFormValues>;
}

/** The record the form starts from — a saved venue when editing, nothing when creating. */
export type VenueFormInitial = Omit<VenueValues, "id">;

function splitList(value: string): string[] {
  return value.split(",");
}

function joinList(values: string[]): string {
  return values.join(", ");
}

/** Spelled out per day so the result is a `Record<Weekday, T>` with no cast. */
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
    facilities: joinList(initial?.facilities ?? []),
    accessibilityFeatures: joinList(initial?.accessibilityFeatures ?? []),
    supportedLayouts: [...(initial?.supportedLayouts ?? [])],
    operatingHours: toFormHours(initial?.operatingHours ?? DEFAULT_OPERATING_HOURS),
  };
}

/**
 * The capacity input is left as typed rather than coerced: `Number("")` is 0 and
 * `Number("12abc")` is NaN, and both must reach the schema as-is so criterion 3's message
 * comes back instead of a silently different number.
 */
function toVenueValues(values: VenueFormValues): unknown {
  const operatingHours: OperatingHours = mapDays(day => {
    const { open, opens, closes } = values.operatingHours[day];
    return open ? { opens, closes } : null;
  });

  const capacity = values.maxCapacity.trim();
  return {
    name: values.name,
    location: values.location,
    maxCapacity: /^-?\d+(\.\d+)?$/.test(capacity) ? Number(capacity) : capacity,
    facilities: splitList(values.facilities),
    accessibilityFeatures: splitList(values.accessibilityFeatures),
    supportedLayouts: values.supportedLayouts,
    operatingHours,
  };
}

interface VenueFormErrors {
  fields: Record<string, { message: string }[]>;
}

function validateVenue(value: VenueFormValues): VenueFormErrors | undefined {
  const parsed = VenueInput.safeParse(toVenueValues(value));
  if (parsed.success) {
    return undefined;
  }

  const fields: VenueFormErrors["fields"] = {};
  for (const issue of parsed.error.issues) {
    // `operatingHours.mon.closes` → the `operatingHours.mon.closes` field; list item paths such
    // as `facilities.2` collapse onto the list input the entry came from.
    const path = issue.path.filter(segment => typeof segment === "string").join(".");
    (fields[path] ??= []).push({ message: issue.message });
  }

  return { fields };
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
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: toFormValues(initial),
    validators: { onSubmit: ({ value }) => validateVenue(value) },
    onSubmit: async ({ value }) => {
      setServerError(null);

      try {
        // Validation has already passed, so this parse is the typed handoff, not a second gate.
        await onSave(VenueInput.parse(toVenueValues(value)));
      } catch (error) {
        setServerError(
          error instanceof Error ? error.message : "Could not save this venue. Try again."
        );
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
      <FieldGroup className="gap-5">
        <form.Field name="name">
          {field => (
            <Field>
              <FieldLabel htmlFor="name">Venue name</FieldLabel>
              <Input
                id="name"
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

        <form.Field name="location">
          {field => (
            <Field>
              <FieldLabel htmlFor="location">Location</FieldLabel>
              <Input
                id="location"
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

        <form.Field name="maxCapacity">
          {field => (
            <Field>
              <FieldLabel htmlFor="maxCapacity">Maximum capacity</FieldLabel>
              <Input
                id="maxCapacity"
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

        <form.Field name="facilities">
          {field => (
            <Field>
              <FieldLabel htmlFor="facilities">Facilities</FieldLabel>
              <Input
                id="facilities"
                type="text"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldDescription>
                Separate entries with commas, e.g. Projector, Stage.
              </FieldDescription>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="accessibilityFeatures">
          {field => (
            <Field>
              <FieldLabel htmlFor="accessibilityFeatures">Accessibility features</FieldLabel>
              <Input
                id="accessibilityFeatures"
                type="text"
                value={field.state.value}
                onChange={e => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldDescription>
                Separate entries with commas, e.g. Step-free access, Hearing loop.
              </FieldDescription>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
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
                    <FieldLabel htmlFor={`layout-${layout}`} className="font-normal">
                      {LAYOUT_LABELS[layout]}
                    </FieldLabel>
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
                      <FieldLabel htmlFor={`open-${day}`} className="font-normal">
                        {WEEKDAY_LABELS[day]}
                      </FieldLabel>
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

        {serverError && <FieldError>{serverError}</FieldError>}

        <form.Subscribe selector={s => s.isSubmitting}>
          {isSubmitting => (
            <Field className="w-fit">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : submitLabel}
              </Button>
            </Field>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}
