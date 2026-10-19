import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Textarea } from "#/components/ui/textarea";
import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";
import { PlaceHoldRequestButton } from "#/features/venue-requests/components/hold-time-dialog";
import {
  VENUE_HOLD_DECLINE_REASON_MAX_LENGTH,
  VenueHoldDeclineInput,
} from "#/features/venue-requests/schema";
import { declineVenueHold } from "#/features/venue-requests/server-fns";
import type { VenueHoldRequest } from "#/features/venue-requests/server-fns";
import { skipRootFilter } from "#/lib/invalidate";

/** PTR-150 AC5: decline a hold request with the reason that the Coordinator receives. */
function DeclineHoldRequestForm({
  request,
  onCancel,
  onSuccess,
}: {
  request: VenueHoldRequest;
  onCancel: () => void;
  onSuccess: () => Promise<void>;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueHoldDeclineInput.safeParse({ id: request.id, reason: value.reason });
        if (parsed.success) return undefined;
        return { fields: { reason: { message: parsed.error.issues[0].message } } };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await declineVenueHold({ data: VenueHoldDeclineInput.parse({ id: request.id, ...value }) });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not decline this hold request. Try again.",
          },
        });
        // Another Venue Staff member can handle the request first. Reload, but keep the message.
        await router.invalidate({ filter: skipRootFilter }).catch(() => {});
        return;
      }

      toast.success(`Hold request declined for ${request.venueName}.`);
      await onSuccess();
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 border-t border-border pt-4"
      onSubmit={event => {
        event.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={`decline-reason-${request.id}`}>Reason for decline</FieldLabel>
            <Textarea
              id={`decline-reason-${request.id}`}
              value={field.state.value}
              maxLength={VENUE_HOLD_DECLINE_REASON_MAX_LENGTH}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>
      <div className="flex gap-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Declining…" : "Confirm decline"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * PTR-150 AC2: the shared hold-request queue. Every Venue Staff member sees each request with its
 * venue, window and requested time, and places it with an expiry or declines it.
 */
export function VenueHoldRequestsPage({ requests }: { requests: readonly VenueHoldRequest[] }) {
  const router = useRouter();
  const [declining, setDeclining] = useState<string | null>(null);

  async function finishDecline() {
    setDeclining(null);
    await router.invalidate({ filter: skipRootFilter });
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Venue operations"
        title="Hold requests"
        description="Coordinators ask to hold a venue before they book it. Place each hold with an expiry, so that no hold reserves a venue indefinitely, or decline it with a reason."
      />

      {requests.length === 0 ? (
        <Card>
          <CardContent>
            <p className="body-sm text-muted-foreground">No hold requests are waiting.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4">
          {requests.map(request => (
            <li key={request.id} aria-labelledby={`hold-request-${request.id}`}>
              <Card>
                <CardContent>
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow text-muted-foreground">Hold request</p>
                        <h2 id={`hold-request-${request.id}`} className="mt-2 display-h3">
                          {request.venueName}
                        </h2>
                        <p className="mt-2 body-sm text-muted-foreground">
                          {formatProposedWindow({ start: request.startsAt, end: request.endsAt })}
                        </p>
                        <p className="mt-1 body-sm text-muted-foreground">
                          Requested {formatLocalDateTime(request.requestedAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <PlaceHoldRequestButton holdId={request.id} />
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeclining(request.id)}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>

                    {declining === request.id ? (
                      <DeclineHoldRequestForm
                        request={request}
                        onCancel={() => setDeclining(null)}
                        onSuccess={finishDecline}
                      />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
