import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Textarea } from "#/components/ui/textarea";
import { formatInstant } from "#/features/event-requests/format";
import {
  CHANGE_REQUEST_DECLINE_REASON_MAX,
  EVENT_CHANGE_REQUEST_CLOSED,
  EventChangeRequestDeclineInput,
} from "#/features/event-requests/schema";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { declineEventChangeRequest } from "#/features/events/server-fns";

type ChangeRequest = EventRequestDetail["changeRequests"][number];

/** PTR-52 AC2: the request the Coordinator is applying through the event information form. */
export interface ApplyingChangeRequest {
  id: number;
  whatShouldChange: string;
  requestedValue: string;
}

/**
 * PTR-52: the Organiser's change requests still waiting on the assigned Coordinator, each with the
 * two decisions (AC2). "Apply" opens the event information form below with the request pinned to
 * it, so the save that applies it records the change and the outcome together and warns about a
 * significant change as any edit does (AC3). "Decline" asks for a reason. A closed event can only
 * decline. The processed requests stay on the record further down the page (AC5).
 */
export function ChangeRequestDecisions({
  requestId,
  changeRequests,
  canApply,
  applyingId,
  onApply,
}: {
  requestId: number;
  changeRequests: ChangeRequest[];
  canApply: boolean;
  applyingId: number | null;
  onApply: (request: ApplyingChangeRequest) => void;
}) {
  const waiting = changeRequests
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(({ item }) => item.outcome === null);
  if (waiting.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="change-request-decisions-heading">
      <Card>
        <CardContent>
          <h2 id="change-request-decisions-heading" className="display-h3">
            Change requests awaiting your decision
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            {canApply
              ? "Apply a request by updating the event information below, or decline it with a reason. The Organiser is told either way."
              : `${EVENT_CHANGE_REQUEST_CLOSED} Each request can only be declined, with a reason the Organiser is told.`}
          </p>
          <ul className="mt-4 divide-y divide-border">
            {waiting.map(({ item, number }) => (
              <ChangeRequestDecision
                key={item.id}
                requestId={requestId}
                item={item}
                number={number}
                canApply={canApply}
                applying={applyingId === item.id}
                onApply={onApply}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

function ChangeRequestDecision({
  requestId,
  item,
  number,
  canApply,
  applying,
  onApply,
}: {
  requestId: number;
  item: ChangeRequest;
  number: number;
  canApply: boolean;
  applying: boolean;
  onApply: (request: ApplyingChangeRequest) => void;
}) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const declineForm = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: EventChangeRequestDeclineInput.omit({ id: true, changeRequestId: true }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await declineEventChangeRequest({
          data: { id: requestId, changeRequestId: item.id, reason: value.reason },
        });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not decline this request. Try again.",
          },
        });
        return;
      }
      toast.success("Change request declined. The Organiser will be notified.");
      await router.invalidate();
    },
  });

  const label = `change request #${number}`;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-muted-foreground">Change request #{number}</span>
        <time dateTime={item.createdAt.toISOString()} className="body-sm text-muted-foreground">
          {formatInstant(item.createdAt)}
        </time>
      </div>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="eyebrow text-muted-foreground">What should change</dt>
          <dd className="mt-2 body-md font-medium whitespace-pre-line">{item.whatShouldChange}</dd>
        </div>
        <div>
          <dt className="eyebrow text-muted-foreground">Requested new value</dt>
          <dd className="mt-2 body-md font-medium whitespace-pre-line">{item.requestedValue}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-3">
        {canApply && (
          <Button
            type="button"
            size="sm"
            disabled={applying}
            aria-label={`Apply ${label}`}
            onClick={() =>
              onApply({
                id: item.id,
                whatShouldChange: item.whatShouldChange,
                requestedValue: item.requestedValue,
              })
            }
          >
            {applying ? "Applying below" : "Apply"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={declining}
          aria-label={`Decline ${label}`}
          onClick={() => setDeclining(open => !open)}
        >
          {declining ? "Keep request" : "Decline"}
        </Button>
      </div>
      {declining && (
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={event => {
            event.preventDefault();
            void declineForm.handleSubmit();
          }}
        >
          <declineForm.Field name="reason">
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={`change-request-${item.id}-reason`}>
                  Reason for declining
                </FieldLabel>
                <Textarea
                  id={`change-request-${item.id}-reason`}
                  rows={3}
                  maxLength={CHANGE_REQUEST_DECLINE_REASON_MAX}
                  value={field.state.value}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onChange={event => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </declineForm.Field>
          <declineForm.Subscribe selector={state => [state.isSubmitting, state.errorMap.onSubmit]}>
            {([isSubmitting, onSubmitError]) => (
              <>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  disabled={Boolean(isSubmitting)}
                  aria-label={`Send the reason and decline ${label}`}
                >
                  {isSubmitting ? "Declining…" : "Decline request"}
                </Button>
                {typeof onSubmitError === "string" ? (
                  <p role="alert" className="body-sm text-destructive">
                    {onSubmitError}
                  </p>
                ) : null}
              </>
            )}
          </declineForm.Subscribe>
        </form>
      )}
    </li>
  );
}
