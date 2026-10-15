import type { FunctionComponent, ReactNode } from "react";

import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { SESSION_REQUIREMENT_INPUTS } from "#/features/venue-requests/schema";
import type { SessionRequirementFormValues } from "#/features/venue-requests/schema";

type SessionRequirementName = keyof SessionRequirementFormValues;

/** What one session input reads from its TanStack Form field. */
interface SessionField {
  state: { value: string; meta: { errors: ({ message?: string } | undefined)[] } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** The part of a TanStack form that the inputs use. A form whose values hold the four fits. */
interface SessionForm {
  Field: (props: {
    name: SessionRequirementName;
    children: (field: SessionField) => ReactNode;
  }) => ReturnType<FunctionComponent>;
}

/**
 * PTR-138 AC1: the four session-requirement inputs of the request panel and the hold-conversion
 * dialog, in the search's words. `idPrefix` keeps the input ids unique on the page. `inputRef`
 * lets the host focus the first input that the schema marked.
 */
export function SessionRequirementFields({
  form,
  idPrefix,
  inputRef,
}: {
  form: SessionForm;
  idPrefix: string;
  inputRef?: (name: SessionRequirementName, element: HTMLInputElement | null) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SESSION_REQUIREMENT_INPUTS.map(({ name, label, type, placeholder }) => (
        <form.Field key={name} name={name}>
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${idPrefix}-${name}`}>{label}</FieldLabel>
              <Input
                id={`${idPrefix}-${name}`}
                ref={inputRef && (element => inputRef(name, element))}
                type={type}
                {...(type === "number" ? { min: "1", step: "1" } : {})}
                placeholder={placeholder}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={changeEvent => field.handleChange(changeEvent.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      ))}
    </div>
  );
}
