import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import type { VipRegistration } from "#/features/events/access";
import {
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_ALREADY_REMOVED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
} from "#/features/events/registration";
import { VIP_EMAIL_MESSAGE, VipRegistrationInput } from "#/features/events/schema";
import { addVipRegistration, removeVipRegistration } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

const NAMED_REFUSALS = new Set([
  VIP_EMAIL_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_ALREADY_REMOVED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
]);

/** The server's named refusal, or "" for any other failure, which the caller words generically. */
function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return NAMED_REFUSALS.has(message) || message.startsWith(EVENT_FULL_MESSAGE) ? message : "";
}

/**
 * PTR-111: the VIP registrations of a published event, for its Organiser and its assigned
 * Coordinator. The VIPs are counted apart from the normal registrations (AC4). The server checks
 * the venue places again when a VIP is added, so its refusal names the venue capacity (AC3).
 */
export function VipRegistrations({ eventId, vips }: { eventId: number; vips: VipRegistration[] }) {
  const router = useRouter();
  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: VipRegistrationInput.omit({ id: true }) },
    onSubmit: async ({ value, formApi }) => {
      let vip: VipRegistration;
      try {
        vip = await addVipRegistration({ data: { id: eventId, ...value } });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: refusalOf(error) || "Could not add the VIP registration. Try again.",
          },
        });
        return;
      }

      toast.success(`${vip.name} is registered as a VIP.`);
      formApi.reset();
      await router.invalidate();
    },
  });
  const headingId = `vip-registrations-${eventId}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-4">
        <p id={headingId} className="body-sm font-medium">
          VIP registrations
        </p>
        <p className="body-sm text-muted-foreground">
          {vips.length === 1 ? "1 VIP" : `${vips.length} VIPs`}
        </p>
      </div>

      {vips.length > 0 && (
        <ul className="mt-3 space-y-3">
          {vips.map(vip => (
            <VipRow key={vip.attendeeId} eventId={eventId} vip={vip} />
          ))}
        </ul>
      )}

      <form
        noValidate
        className="mt-4 space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`${headingId}-email`}>Attendee email</FieldLabel>
              <Input
                id={`${headingId}-email`}
                type="email"
                autoComplete="off"
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
              <Button type="submit" size="sm" disabled={Boolean(isSubmitting)}>
                {isSubmitting ? "Adding…" : "Add VIP"}
              </Button>
              {typeof onSubmitError === "string" ? (
                <p role="alert" className="body-sm text-destructive">
                  {onSubmitError}
                </p>
              ) : null}
            </>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}

/** AC6: one VIP registration and its removal. */
function VipRow({ eventId, vip }: { eventId: number; vip: VipRegistration }) {
  const router = useRouter();
  const [state, remove, removing] = useMutation(async () => {
    try {
      await removeVipRegistration({ data: { id: eventId, attendeeId: vip.attendeeId } });
    } catch (error) {
      // Someone else may have removed it since this page loaded.
      await router.invalidate();
      throw new Error(refusalOf(error), { cause: error });
    }
    toast.success(`${vip.name} is no longer registered as a VIP.`);
    await router.invalidate();
  }, "Could not remove this VIP registration. Try again.");

  return (
    <li className="body-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{vip.name}</p>
          <p className="break-all text-muted-foreground">{vip.email}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={removing}
          aria-label={`Remove VIP registration: ${vip.name}`}
          onClick={() => void remove()}
        >
          {removing ? "Removing…" : "Remove"}
        </Button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="mt-1 text-destructive">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}
