import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Textarea } from "#/components/ui/textarea";
import { CHANGE_REQUEST_TEXT_MAX, EventChangeRequestInput } from "#/features/event-requests/schema";
import { raiseEventChangeRequest } from "#/features/event-requests/server-fns";

export function EventChangeRequestForm({ requestId }: { requestId: number }) {
  const router = useRouter();
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm({
    defaultValues: { whatShouldChange: "", requestedValue: "" },
    validators: {
      onSubmit: EventChangeRequestInput.omit({ id: true }),
    },
    onSubmit: async ({ value, formApi }) => {
      if (saved) return;
      setDeliveryWarning(null);

      try {
        await raiseEventChangeRequest({ data: { id: requestId, ...value } });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error
                ? error.message
                : "Could not record the change request. Try again.",
          },
        });
        return;
      }

      setSaved(true);
      toast.success("Change request recorded.");
      formApi.reset();

      try {
        await router.invalidate();
      } catch {
        const message =
          "Your change request was saved. Refresh this page to see the updated history.";
        setDeliveryWarning(message);
        toast.warning(message);
      }
    },
  });

  return (
    <form
      noValidate
      className="mt-5 space-y-4"
      onSubmit={event => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="whatShouldChange">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>What should change</FieldLabel>
            <Textarea
              id={field.name}
              rows={3}
              maxLength={CHANGE_REQUEST_TEXT_MAX}
              disabled={saved}
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Field name="requestedValue">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={field.name}>Requested new value</FieldLabel>
            <Textarea
              id={field.name}
              rows={3}
              maxLength={CHANGE_REQUEST_TEXT_MAX}
              disabled={saved}
              value={field.state.value}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={state => [state.isSubmitting, state.errorMap.onSubmit]}>
        {([isSubmitting, onSubmitError]) => (
          <>
            <Button type="submit" disabled={saved || Boolean(isSubmitting)}>
              {saved ? "Request recorded" : isSubmitting ? "Recording…" : "Request change"}
            </Button>
            {typeof onSubmitError === "string" ? (
              <p role="alert" className="body-sm text-destructive">
                {onSubmitError}
              </p>
            ) : null}
          </>
        )}
      </form.Subscribe>
      {deliveryWarning && (
        <output className="body-sm text-muted-foreground">{deliveryWarning}</output>
      )}
    </form>
  );
}
