import { createContext, useContext, useId, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Textarea } from "#/components/ui/textarea";
import { UpdateEventInformation } from "#/features/coordination/components/update-event-information";
import type { CoordinationRequest } from "#/features/coordination/server-fns";
import { formatInstant } from "#/features/event-requests/format";
import {
  CHANGE_REQUEST_DECLINE_REASON_MAX,
  EVENT_CHANGE_REQUEST_CLOSED,
  EventChangeRequestDeclineInput,
  canApplyEventChangeRequest,
  canUpdateEventInformation,
} from "#/features/event-requests/schema";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { declineEventChangeRequest } from "#/features/events/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

type ChangeRequest = EventRequestDetail["changeRequests"][number];

export const CHANGE_REQUEST_DECISIONS_HEADING_ID = "change-request-decisions-heading";

/**
 * Where focus lands once a decision has taken a request off this card: the card's heading while
 * other requests still wait, otherwise the record of every request below it.
 */
export function focusChangeRequests() {
  (
    document.getElementById(CHANGE_REQUEST_DECISIONS_HEADING_ID) ??
    document.getElementById("change-requests-heading")
  )?.focus();
}

/** Moves focus to the pinned request the apply form holds, in whichever section it opened. */
function focusApplyingForm() {
  const pinned = document
    .getElementById("update-information-heading")
    ?.closest("section")
    ?.querySelector("h3");
  if (pinned instanceof HTMLElement) pinned.focus();
}

/**
 * PTR-52: the apply in progress on the event page. The decisions card in the change requests
 * section starts it, and the event information form saves it, so the two sections share the id
 * of the request being applied and whether the form holds unsaved edits. Only the id is kept; the
 * request itself is read from the live record.
 */
interface ChangeRequestApplyState {
  applyingId: number | null;
  setApplyingId: (id: number | null) => void;
  informationDirty: boolean;
  setInformationDirty: (dirty: boolean) => void;
}

const ChangeRequestApplyContext = createContext<ChangeRequestApplyState | null>(null);

/** Holds the apply for every section of one event page. */
export function ChangeRequestApplyProvider({ children }: { children: ReactNode }) {
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [informationDirty, setInformationDirty] = useState(false);
  const value = useMemo(
    () => ({ applyingId, setApplyingId, informationDirty, setInformationDirty }),
    [applyingId, informationDirty]
  );
  return <ChangeRequestApplyContext value={value}>{children}</ChangeRequestApplyContext>;
}

/**
 * The apply on `request`, read from the live record: a request processed elsewhere, or an event
 * closed since, is no longer applying on the next read.
 */
function useChangeRequestApply(request: CoordinationRequest) {
  const state = useContext(ChangeRequestApplyContext);
  if (!state) throw new Error("A change request apply needs a ChangeRequestApplyProvider.");
  const applying = canApplyEventChangeRequest(request.status)
    ? (request.changeRequests.find(item => item.id === state.applyingId && item.outcome === null) ??
      null)
    : null;
  return { ...state, applying };
}

/**
 * The assigned Coordinator's event information form: a direct edit in the statuses that allow
 * one (PTR-22), and the apply of a waiting change request in every status the request could be
 * raised in (PTR-52). Outside the direct-edit statuses it shows only while an apply is open.
 */
export function CoordinatorInformationForm({ request }: { request: CoordinationRequest }) {
  const { applying, setApplyingId, setInformationDirty } = useChangeRequestApply(request);
  if (!canUpdateEventInformation(request.status) && applying === null) return null;

  function endApply() {
    // The form may unmount with the apply (no direct edit in this status), so focus is placed
    // first; the form moves it on to its own toggle when that survives.
    flushSync(() => setApplyingId(null));
    focusChangeRequests();
  }

  return (
    <UpdateEventInformation
      request={request}
      applying={applying}
      onApplyEnd={endApply}
      onDirtyChange={setInformationDirty}
    />
  );
}

/**
 * PTR-52: the Organiser's change requests still waiting on the assigned Coordinator, each with the
 * two decisions (AC2). "Apply" opens the event information form with the request pinned to it, so
 * the save that applies it records the change and the outcome together and warns about a
 * significant change as any edit does (AC3). "Decline" asks for a reason. A closed event can only
 * decline. The processed requests stay on the record below the card (AC5).
 */
export function ChangeRequestDecisions({ request }: { request: CoordinationRequest }) {
  const { applying, setApplyingId, informationDirty } = useChangeRequestApply(request);
  const canApply = canApplyEventChangeRequest(request.status);
  const waiting = request.changeRequests.flatMap((item, index) =>
    item.outcome === null ? [{ item, number: index + 1 }] : []
  );
  if (waiting.length === 0) return null;

  return (
    <section aria-labelledby={CHANGE_REQUEST_DECISIONS_HEADING_ID}>
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
                requestId={request.id}
                item={item}
                number={number}
                canApply={canApply}
                applying={applying?.id === item.id}
                // Unsaved edits in the form are never replaced by an apply unasked.
                applyDisabled={informationDirty}
                onApply={next => setApplyingId(next.id)}
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
  const [declining, setDeclining] = useState(false);
  // The toggle unmounts with the form, so cancel returns focus to it once it is back.
  const declineToggleRef = useRef<HTMLButtonElement>(null);
  const applyHintId = useId();

  const label = `change request #${number}`;

  function handleCancelDeclining() {
    flushSync(() => setDeclining(false));
    declineToggleRef.current?.focus();
  }

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
          <dd className="mt-2 body-sm font-medium whitespace-pre-line">{item.whatShouldChange}</dd>
        </div>
        <div>
          <dt className="eyebrow text-muted-foreground">Requested new value</dt>
          <dd className="mt-2 body-sm font-medium whitespace-pre-line">{item.requestedValue}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DecisionActions
          canApply={canApply}
          applying={applying}
          declining={declining}
          applyDisabled={applyDisabled}
          applyHintId={applyHintId}
          label={label}
          declineToggleRef={declineToggleRef}
          onApply={() => onApply(item)}
          onDecline={() => setDeclining(true)}
        />
      </div>
      {declining && (
        <DeclineRequestForm
          requestId={requestId}
          item={item}
          number={number}
          onCancel={handleCancelDeclining}
        />
      )}
    </li>
  );
}

/** One row's Apply and Decline, or the link to the request already being applied. */
function DecisionActions({
  canApply,
  applying,
  declining,
  applyDisabled,
  applyHintId,
  label,
  declineToggleRef,
  onApply,
  onDecline,
}: {
  canApply: boolean;
  applying: boolean;
  declining: boolean;
  applyDisabled: boolean;
  applyHintId: string;
  label: string;
  declineToggleRef: RefObject<HTMLButtonElement | null>;
  onApply: () => void;
  onDecline: () => void;
}) {
  function applyButton(disabled: boolean) {
    if (!canApply) return null;
    return (
      <>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          aria-label={`Apply ${label}`}
          aria-describedby={applyDisabled ? applyHintId : undefined}
          onClick={onApply}
        >
          Apply
        </Button>
        {applyDisabled && (
          <p id={applyHintId} className="body-sm text-muted-foreground">
            Save or discard the open edits to apply another request.
          </p>
        )}
      </>
    );
  }

  if (applying) {
    return (
      <>
        {applyButton(true)}
        <a
          href="#update-information-heading"
          onClick={event => {
            event.preventDefault();
            focusApplyingForm();
          }}
          className={`body-sm ${NAV_LINK_CLASSNAME}`}
        >
          Being applied in the event information form.
        </a>
      </>
    );
  }
  if (declining) return applyButton(true);
  return (
    <>
      {applyButton(applyDisabled)}
      <Button
        ref={declineToggleRef}
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Decline ${label}`}
        onClick={onDecline}
      >
        Decline
      </Button>
    </>
  );
}

/** The decline reason, mounted only while one row asks for it. */
function DeclineRequestForm({
  requestId,
  item,
  number,
  onCancel,
}: {
  requestId: number;
  item: ChangeRequest;
  number: number;
  onCancel: () => void;
}) {
  const router = useRouter();
  const formId = useId();
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
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the decline form opens on demand; focus lands on its reason field
              autoFocus
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
                onClick={onCancel}
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
  );
}
