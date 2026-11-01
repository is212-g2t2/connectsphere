import type { ReactNode } from "react";

import { cn } from "cn";

export interface FormError {
  fieldId: string;
  label: string;
  message: string;
}

/**
 * The invalid fields as anchors above the actions. Each entry links to its field,
 * so one summary serves every invalid control on a long form.
 */
export function FormErrorSummary({ errors }: { errors: FormError[] }) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        {errors.length === 1 ? "There is a problem" : `There are ${errors.length} problems`}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {errors.map(error => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
            >
              {error.label}: {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Keep the submit row reachable on a long form. Sticky at every width, with safe-area padding. */
export function StickyFormActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background py-4 pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Scroll to the first invalid field and move focus there. A no-op on an empty list. */
export function focusFirstInvalid(errors: Pick<FormError, "fieldId">[]): void {
  const first = errors[0];
  if (!first) return;
  const field = document.getElementById(first.fieldId);
  if (!field) return;
  if (typeof field.scrollIntoView === "function") {
    field.scrollIntoView({ block: "center" });
  }
  if (typeof field.focus === "function") {
    field.focus({ preventScroll: true });
  }
}

/** Read the message from a form error, which is a string or a `{ message }` object. */
export function formErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error !== "") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return null;
}

/** The meta slice the collector reads. Matches the TanStack field meta the forms pass. */
export interface FieldErrorsMeta {
  errors?: readonly unknown[];
}

/**
 * List the invalid fields in mount order for the error summary. Name each field with
 * `labelsFor`, which each form keeps beside its labels.
 */
export function collectFormErrors(
  fieldMeta: Record<string, FieldErrorsMeta | undefined>,
  labelsFor: (name: string) => { fieldId: string; label: string }
): FormError[] {
  const errors: FormError[] = [];
  for (const [name, meta] of Object.entries(fieldMeta)) {
    const message = meta?.errors?.map(formErrorMessage).find(Boolean) ?? null;
    if (!message) continue;
    errors.push({ ...labelsFor(name), message });
  }
  return errors;
}
