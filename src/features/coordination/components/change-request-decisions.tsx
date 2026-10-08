import { useEffect, useId, useRef, useState } from "react";
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

export const CHANGE_REQUEST_DECISIONS_HEADING_ID = "change-request-decisions-heading";

/**
 * Where focus lands once a decision has taken a request off this card: the card's heading while
 * other requests still wait, otherwise the record of every request further down the page.
 */
export function focusChangeRequests() {
  (
    document.getElementById(CHANGE_REQUEST_DECISIONS_HEADING_ID) ??
    document.getElementById("change-requests-heading")
  )?.focus();
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
  applyDisabled,
  onApply,
}: {
  requestId: number;
  changeRequests: ChangeRequest[];
  canApply: boolean;
  /** The request whose apply is open in the form below, if any. */
  applyingId: number | null;
  /** True while the form below holds unsaved edits, so no apply can replace them unasked. */
  applyDisabled: boolean;
  onApply: (request: ChangeRequest) => void;
}) {
  const waiting = changeRequests
    .map((item, index) => ({ item, number: index + 1 }))
    .filter(({ item }) => item.outcome === null);
  if (waiting.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby={CHANGE_REQUEST_DECISIONS_HEADING_ID}>
      <Card>
        <CardContent>
          <h2
            id={CHANGE_REQUEST_DECISIONS_HEADING_ID}
            tabIndex={-1}
            className="display-h3 outline-none"
          >
            Change requests awaiting your decision
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            {canApply
              ? "Apply a request by updating the event information below, or decline it with a reason. The Organiser is told in both cases."
              : `${EVENT_CHANGE_REQUEST_CLOSED} Decline each request to tell the Organiser why.`}
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
                applyDisabled={applyDisabled}
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
  applyDisabled,
  onApply,
}: {
  requestId: number;
  item: ChangeRequest;
  number: number;
  canApply: boolean;
  applying: boolean;
  applyDisabled: boolean;
  onApply: (request: ChangeRequest) => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [declining, setDeclining] = useState(false);
  const reason = useRef<HTMLTextAreaElement>(null);
  // The toggle that opened the form is gone with it, so the reason takes focus in its place.
  useEffect(() => {
    if (declining) reason.current?.focus();
  }, [declining]);
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
      try {
        await router.invalidate();
      } catch {
        // The decline committed; only the re-read failed.
        toast.warning("The request was declined. Refresh this page to see it.");
        return;
      }
      // The re-read took this item off the card, and the button that had focus with it.
      focusChangeRequests();
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
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canApply && (
          <Button
            type="button"
            size="sm"
            disabled={applying || applyDisabled || declining}
            aria-label={`Apply ${label}`}
            onClick={() => onApply(item)}
          >
            Apply
          </Button>
        )}
        {applying ? (
          <output className="body-sm text-muted-foreground">
            Being applied in the form below.
          </output>
        ) : (
          !declining && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={declining}
              aria-controls={formId}
              aria-label={`Decline ${label}`}
              onClick={() => setDeclining(true)}
            >
              Decline
            </Button>
          )
        )}
      </div>
      {declining && (
        <form
          id={formId}
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
                <FieldLabel htmlFor={`${formId}-reason`}>Reason for declining</FieldLabel>
                <Textarea
                  ref={reason}
                  id={`${formId}-reason`}
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
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    disabled={Boolean(isSubmitting)}
                    aria-label={`Decline request #${number} with this reason`}
                  >
                    {isSubmitting ? "Declining…" : "Decline request"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(isSubmitting)}
                    aria-label={`Cancel declining ${label}`}
                    onClick={() => {
                      declineForm.reset();
                      setDeclining(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
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
