import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
  CancellationDecision,
  OutstandingReleasesList,
} from "#/features/coordination/components/cancellation-decision";
import {
  ChangeRequestDecisions,
  CoordinatorInformationForm,
} from "#/features/coordination/components/change-request-decisions";
import {
  CoordinatorSelection,
  DECISION_REASON_MAX_LENGTH,
  DecisionFormSchema,
  parseDecisionInput,
} from "#/features/coordination/schema";
import {
  assignEventRequest,
  decideEventRequest,
  raiseClarificationRequest,
  requestEventHandover,
  takeUpEventRequestForReview,
} from "#/features/coordination/server-fns";
import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import {
  ChangeRequestHistory,
  ClarificationThread,
} from "#/features/event-requests/components/request-message-blocks";
import { formatInstant, formatProposedWindow } from "#/features/event-requests/format";
import {
  CLARIFICATION_FIELDS,
  CLARIFICATION_TEXT_MAX,
  ClarificationFormSchema,
  canRequestEventCancellation,
  canUpdateEventInformation,
} from "#/features/event-requests/schema";
import type { ClarificationField, EventRequestStatus } from "#/features/event-requests/schema";
import { ConfirmEventAction } from "#/features/events/components/confirm-event-action";
import { CompleteEventAction } from "#/features/events/components/complete-event-action";
import { isConfirmableStatus } from "#/features/events/confirmation";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** The review stages: the decision, the clarification thread, and the assignment all live here. */
const REVIEW_STATUSES: readonly EventRequestStatus[] = [
  "submitted",
  "under_review",
  "awaiting_organiser",
];

/** The stages with live coordination work: review onward, short of closed. */
const ACTIVE_STATUSES: readonly EventRequestStatus[] = [
  ...REVIEW_STATUSES,
  "approved",
  "planning",
  "confirmed",
];

/** A cancellation request with no outcome recorded is still waiting on the Coordinator. */
function hasPendingCancellation(data: EventPageData): boolean {
  const requests =
    data.kind === "triage"
      ? data.request.cancellationRequests
      : (data.coordination?.request.cancellationRequests ??
        data.organiserRequest?.cancellationRequests ??
        []);
  return requests.some(request => request.outcome === null);
}

function hasChangeHistory(data: EventPageData): boolean {
  const requests =
    data.kind === "triage"
      ? data.request.changeRequests
      : (data.coordination?.request.changeRequests ?? data.organiserRequest?.changeRequests ?? []);
  return requests.length > 0;
}

/** The clarification thread has entries to show, mirroring `MessagesBody`'s null condition. */
function hasClarifications(data: EventPageData): boolean {
  const clarifications =
    data.kind === "triage"
      ? data.request.clarifications
      : (data.coordination?.request.clarifications ?? data.organiserRequest?.clarifications ?? []);
  return clarifications.length > 0;
}

/** The request carries outstanding releases, mirroring `ReleasesBody`'s null condition. */
function hasOutstandingReleases(data: EventPageData): boolean {
  const releases = coordinationRequest(data)?.outstandingReleases;
  return releases !== null && releases !== undefined;
}

/** The Coordinator's status: the triage request's own, else the assigned event's. */
function coordinationStatus(data: EventPageData): EventRequestStatus | null {
  if (data.kind === "triage") return data.request.status;
  return data.event.access === "coordinator" ? data.event.event.status : null;
}

/**
 * The coordination request behind either page kind. `kind: "event"` with coordinator access
 * means the viewer is the assigned Coordinator (`getEventAccess` grants it only then); triage
 * is the unassigned view. Nothing renders when the request is absent.
 */
function coordinationRequest(data: EventPageData): CoordinationRequest | null {
  if (data.kind === "triage") return data.request;
  return data.coordination?.request ?? null;
}

function coordinationTeam(data: EventPageData): Coordinator[] | null {
  if (data.kind === "triage") return data.coordinators;
  return data.coordination?.coordinators ?? null;
}

/** The viewer holds this request exactly when the page is the assigned (event) kind. */
function isAssignedView(data: EventPageData, request: CoordinationRequest): boolean {
  return data.kind === "event" && request.assignedCoordinatorId !== null;
}

/**
 * The Coordinator's review flow: the request record, the decision, the clarification thread,
 * change requests, the assignment, and a waiting cancellation request. Triage renders the record
 * and the assignment only — the review flow needs an assignee, so it stays on the event view.
 *
 * Gating contract: SectionStack shows only sections whose `visible()` passes, while each body
 * still null-checks its own empty state — tests render bodies directly and bypass `visible()`.
 */
export function coordinatorSections(data: EventPageData): EventSectionDef[] {
  const status = coordinationStatus(data);
  if (status === null) return [];
  // Triage is the unassigned view; only the assigned event view carries the review flow.
  const assignedView = data.kind === "event";
  const inReview = REVIEW_STATUSES.some(candidate => candidate === status);
  return [
    {
      id: "request",
      label: "Request details",
      visible: () => inReview,
      render: inner => <RequestDetailsBody data={inner} />,
    },
    {
      id: "review",
      label: "Review decision",
      visible: () => assignedView && inReview,
      render: inner => <ReviewBody data={inner} />,
    },
    {
      id: "messages",
      label: "Clarification thread",
      visible: inner => assignedView && inReview && hasClarifications(inner),
      render: inner => <MessagesBody data={inner} />,
    },
    {
      id: "changes",
      label: "Change requests",
      visible: inner => assignedView && hasChangeHistory(inner),
      render: inner => <ChangesBody data={inner} />,
    },
    {
      id: "assignment",
      label: "Assignment and handover",
      visible: () => ACTIVE_STATUSES.some(candidate => candidate === status),
      render: inner => <AssignmentBody data={inner} />,
    },
    {
      id: "cancellation",
      label: "Cancellation request",
      visible: inner =>
        assignedView &&
        hasPendingCancellation(inner) &&
        coordinationRequest(inner)?.status !== "cancelled",
      render: inner => <CancellationBody data={inner} />,
    },
  ];
}

/**
 * The Coordinator's two closing blocks: confirming a plannable event, and the outstanding
 * releases of a cancelled one. Assigned views only — triage has no event to close.
 */
export function coordinatorClosingSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event") return [];
  const status = coordinationStatus(data);
  if (status === null) return [];
  return [
    {
      id: "confirm",
      label: "Confirm event",
      visible: () => isConfirmableStatus(status),
      render: inner => <ConfirmBody data={inner} />,
    },
    {
      id: "complete",
      label: "Complete event",
      visible: () => status === "confirmed",
      render: inner => <CompleteBody data={inner} />,
    },
    {
      id: "releases",
      label: "Outstanding releases",
      visible: inner => status === "cancelled" && hasOutstandingReleases(inner),
      render: inner => <ReleasesBody data={inner} />,
    },
  ];
}

/**
 * The read-only request record for the review statuses and triage: who raised it, who holds it,
 * and what was asked for. Drawn from the coordination request, falling back to the projection
 * where the request is absent.
 */
function RequestDetailsBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  const projection = data.kind === "event" ? data.event.event : null;
  if (!request && !projection) return null;
  const equipment =
    request?.equipmentRequirements
      .map(line =>
        typeof line === "string"
          ? line
          : line.quantity
            ? `${line.quantity}× ${line.type}`
            : line.type
      )
      .filter(line => line.trim() !== "") ?? [];
  return (
    <div>
      <h2 className="display-h3">Request details</h2>
      <Card className="mt-4">
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {request && (
              <Record
                label="Organiser"
                value={
                  <>
                    {request.organiser.name}
                    <br />
                    <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
                      {request.organiser.email}
                    </a>
                  </>
                }
              />
            )}
            {request && (
              <Record
                label="Coordinator"
                value={
                  request.coordinator ? (
                    <>
                      {request.coordinator.name}
                      <br />
                      <a
                        href={`mailto:${request.coordinator.email}`}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {request.coordinator.email}
                      </a>
                    </>
                  ) : request.assignedCoordinatorId ? (
                    <span className="text-muted-foreground">Assigned coordinator unavailable</span>
                  ) : (
                    <span className="text-muted-foreground">Not yet assigned</span>
                  )
                }
              />
            )}
            <Record
              label="Proposed dates and times"
              value={
                request && request.proposedDates.length > 0
                  ? request.proposedDates.map(window => formatProposedWindow(window)).join("; ")
                  : "Not yet chosen"
              }
            />
            {(request?.expectedAttendance ?? projection?.expectedAttendance ?? null) !== null && (
              <Record
                label="Expected attendance"
                value={String(request?.expectedAttendance ?? projection?.expectedAttendance)}
              />
            )}
            {(request?.roomLayoutPreference || projection?.layout) && (
              <Record
                label="Room-layout preference"
                value={request?.roomLayoutPreference || projection?.layout || ""}
              />
            )}
            {(request?.accessibilityRequirements || projection?.accessibilityRequirements) && (
              <Record
                label="Accessibility requirements"
                value={
                  request?.accessibilityRequirements || projection?.accessibilityRequirements || ""
                }
              />
            )}
            {(request?.venueRequirements || projection?.requiredFacilities) && (
              <Record
                label="Venue requirements"
                value={request?.venueRequirements || projection?.requiredFacilities || ""}
              />
            )}
            {equipment.length > 0 && (
              <Record label="Equipment requirements" value={equipment.join(", ")} />
            )}
            {request?.purpose && <Record label="Purpose" value={request.purpose} />}
            {(request?.description || projection?.description) && (
              <Record
                label="Description"
                value={request?.description || projection?.description || ""}
              />
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

/** One labelled row of the request record. */
function Record({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 body-sm whitespace-pre-line text-foreground">{value}</dd>
    </div>
  );
}

/**
 * The decision, the clarification form, and the take-up, as the old coordination detail shows
 * them. Each block gates itself on its own status, so triage (never assigned) renders nothing.
 */
function ReviewBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request) return null;
  const assigned = isAssignedView(data, request);
  const takeUp = assigned && request.status === "submitted";
  const decide = assigned && request.status === "under_review";
  const clarify =
    assigned && (request.status === "under_review" || request.status === "awaiting_organiser");
  if (!takeUp && !decide && !clarify) return null;
  return (
    <div>
      <h2 className="display-h3">Review decision</h2>
      <div className="mt-4 space-y-8">
        {takeUp && <TakeUpBlock request={request} />}
        {decide && <DecideBlock request={request} />}
        {clarify && <ClarifyBlock request={request} />}
      </div>
    </div>
  );
}

function TakeUpBlock({ request }: { request: CoordinationRequest }) {
  const router = useRouter();
  const [review, takeUpReview, takingUp] = useMutation(async () => {
    await takeUpEventRequestForReview({ data: { id: request.id } });
    toast.success("Request taken up for review.");
    try {
      await router.invalidate();
    } catch {
      // The take-up already committed; a missed refresh must not mask it as an error.
    }
  }, "Could not take up this request for review. Try again.");

  return (
    <section aria-labelledby="review-heading">
      <Card>
        <CardContent>
          <h3 id="review-heading" className="display-h3">
            Take up for review
          </h3>
          <p className="mt-2 body-sm text-muted-foreground">
            Move this request into review once you&apos;re ready to assess it.
          </p>
          <Button
            type="button"
            className="mt-4 self-start"
            disabled={takingUp}
            onClick={() => void takeUpReview()}
          >
            {takingUp ? "Taking up…" : "Take up for review"}
          </Button>
          {review.status === "error" && (
            <p role="alert" className="mt-4 body-sm text-destructive">
              {review.error}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function DecideBlock({ request }: { request: CoordinationRequest }) {
  const router = useRouter();
  const decisionForm = useForm({
    defaultValues: { decision: "approved" as "approved" | "rejected", reason: "" },
    validators: { onSubmit: DecisionFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const input = parseDecisionInput({
          id: request.id,
          decision: value.decision,
          reason: value.reason,
        });
        await decideEventRequest({ data: input });
        toast.success(input.decision === "approved" ? "Request approved." : "Request rejected.");
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not record this decision. Try again.",
          },
        });
        return;
      }
      try {
        await router.invalidate();
      } catch {
        // The decision already committed; a missed refresh must not mask it as an error.
      }
    },
  });

  function submitDecision(decision: "approved" | "rejected") {
    decisionForm.setFieldValue("decision", decision);
    void decisionForm.handleSubmit();
  }

  return (
    <section aria-labelledby="decision-heading">
      <Card>
        <CardContent>
          <h3 id="decision-heading" className="display-h3">
            Record a decision
          </h3>
          <p className="mt-2 body-sm text-muted-foreground">
            A reason is required for rejection and optional for approval. The Organiser will be
            notified of the outcome.
          </p>
          <form
            noValidate
            className="mt-5 space-y-4"
            onSubmit={event => {
              event.preventDefault();
            }}
          >
            <decisionForm.Field name="reason">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="decisionReason">Decision reason</FieldLabel>
                  <Textarea
                    id="decisionReason"
                    value={field.state.value}
                    maxLength={DECISION_REASON_MAX_LENGTH}
                    aria-invalid={field.state.meta.errors.length > 0}
                    onChange={event => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </decisionForm.Field>
            <decisionForm.Subscribe selector={s => [s.isSubmitting, s.errorMap.onSubmit]}>
              {([isSubmitting, onSubmitError]) => (
                <>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      disabled={Boolean(isSubmitting)}
                      onClick={() => submitDecision("approved")}
                    >
                      {isSubmitting ? "Recording…" : "Approve request"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={Boolean(isSubmitting)}
                      onClick={() => submitDecision("rejected")}
                    >
                      Reject request
                    </Button>
                  </div>
                  {typeof onSubmitError === "string" ? (
                    <p role="alert" className="body-sm text-destructive">
                      {onSubmitError}
                    </p>
                  ) : null}
                </>
              )}
            </decisionForm.Subscribe>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

function ClarifyBlock({ request }: { request: CoordinationRequest }) {
  const router = useRouter();
  const clarificationForm = useForm({
    defaultValues: { body: "", permittedFields: [] as ClarificationField[] },
    validators: { onSubmit: ClarificationFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await raiseClarificationRequest({
          data: {
            id: request.id,
            body: value.body,
            permittedFields: value.permittedFields,
          },
        });
        toast.success("Clarification request sent.");
        clarificationForm.reset();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error
                ? error.message
                : "Could not send clarification request. Try again.",
          },
        });
        return;
      }
      try {
        await router.invalidate();
      } catch {
        // The request already sent; a missed refresh must not mask it as an error.
      }
    },
  });

  return (
    <section aria-labelledby="clarification-heading">
      <Card>
        <CardContent>
          <h3 id="clarification-heading" className="display-h3">
            Request clarification
          </h3>
          <p className="mt-2 body-sm text-muted-foreground">
            Ask the Organiser for more details before recording a decision.
          </p>
          <form
            noValidate
            className="mt-5 space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void clarificationForm.handleSubmit();
            }}
          >
            <clarificationForm.Field name="body">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="clarification-body">What needs clarification</FieldLabel>
                  <Textarea
                    id="clarification-body"
                    className="mt-2"
                    rows={4}
                    maxLength={CLARIFICATION_TEXT_MAX}
                    placeholder="Describe what needs clarification (e.g. required room layout, specific equipment models)..."
                    value={field.state.value}
                    onChange={e => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </clarificationForm.Field>
            <clarificationForm.Field name="permittedFields">
              {field => (
                <div className="border-t border-border pt-4">
                  <FieldSet>
                    <FieldLegend>Allow the Organiser to amend these fields (optional)</FieldLegend>
                    <FieldDescription>
                      Leave every field unselected when you only need an explanation.
                    </FieldDescription>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {CLARIFICATION_FIELDS.map(({ key, label }) => (
                        <Field key={key} orientation="horizontal">
                          <Checkbox
                            id={`clarification-field-${key}`}
                            checked={field.state.value.includes(key)}
                            onCheckedChange={checked => {
                              field.handleChange(
                                checked
                                  ? [...field.state.value, key]
                                  : field.state.value.filter(value => value !== key)
                              );
                            }}
                          />
                          <FieldLabel htmlFor={`clarification-field-${key}`}>{label}</FieldLabel>
                        </Field>
                      ))}
                    </div>
                  </FieldSet>
                </div>
              )}
            </clarificationForm.Field>
            <clarificationForm.Subscribe selector={s => [s.isSubmitting, s.errorMap.onSubmit]}>
              {([isSubmitting, onSubmitError]) => (
                <>
                  <Button type="submit" disabled={Boolean(isSubmitting)}>
                    {isSubmitting ? "Sending…" : "Send clarification request"}
                  </Button>
                  {typeof onSubmitError === "string" ? (
                    <p role="alert" className="body-sm text-destructive">
                      {onSubmitError}
                    </p>
                  ) : null}
                </>
              )}
            </clarificationForm.Subscribe>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

/** The clarification thread, read-only for the Coordinator — the reply forms are the Organiser's. */
function MessagesBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request || request.clarifications.length === 0) return null;
  return <ClarificationThread request={request} replyable={false} />;
}

/**
 * The change-request history with its outcomes (PTR-52 AC5). While a request waits, the assigned
 * Coordinator gets the decisions card above it, and, in a status with no direct edit, the form
 * that applies a request opens below the card instead of in the event information section.
 */
function ChangesBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request || request.changeRequests.length === 0) return null;
  const processing =
    isAssignedView(data, request) && request.changeRequests.some(item => item.outcome === null);
  return (
    <div className="space-y-8">
      {processing && <ChangeRequestDecisions request={request} />}
      {processing && !canUpdateEventInformation(request.status) && (
        <CoordinatorInformationForm request={request} />
      )}
      <ChangeRequestHistory request={request} />
    </div>
  );
}

/**
 * The assignment and handover, as the old coordination detail shows it. The viewer identity
 * rides `EventPageData` from the loader for the "Assign to me" claim and the "— you" label.
 * Every mutation refreshes the loader in place: claiming the request flips the page to the
 * assigned view on its own.
 */
function AssignmentBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  const coordinators = coordinationTeam(data);
  const router = useRouter();
  if (!request || !coordinators) return null;

  return (
    <div>
      <h2 className="display-h3">Assignment and handover</h2>
      <div className="mt-4 space-y-4">
        <AssignmentSummary request={request} />
        <AssignmentForm
          request={request}
          coordinators={coordinators}
          viewerId={data.viewerId}
          onAssigned={async () => {
            await router.invalidate();
          }}
        />
      </div>
    </div>
  );
}

/**
 * Who holds this request, beside the form that moves it: the Organiser, the current
 * Coordinator, and when it changed hands or was offered on. The form below carries only
 * the move itself.
 */
function AssignmentSummary({ request }: { request: CoordinationRequest }) {
  const pendingHandover = request.pendingHandover;
  return (
    <Card>
      <CardContent>
        <dl className="grid gap-4">
          <Record
            label="Organiser"
            value={
              <>
                {request.organiser.name}
                <br />
                <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
                  {request.organiser.email}
                </a>
              </>
            }
          />
          <Record
            label="Coordinator"
            value={
              request.coordinator ? (
                <>
                  {request.coordinator.name}
                  <br />
                  <a href={`mailto:${request.coordinator.email}`} className={NAV_LINK_CLASSNAME}>
                    {request.coordinator.email}
                  </a>
                </>
              ) : request.assignedCoordinatorId !== null ? (
                <span className="text-muted-foreground">Assigned coordinator unavailable</span>
              ) : (
                <span className="text-muted-foreground">Not yet assigned</span>
              )
            }
          />
          {pendingHandover ? (
            <Record
              label="Handover offer"
              value={`Offered to ${pendingHandover.toName} on ${formatInstant(
                pendingHandover.requestedAt
              )}. You remain the assigned Coordinator until they accept; offering it to someone else replaces this offer.`}
            />
          ) : request.assignedAt ? (
            <Record
              label="Assigned"
              value={`Assigned on ${formatInstant(request.assignedAt)}. The request stays yours until the incoming Coordinator accepts; a declined handover leaves it with you.`}
            />
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function AssignmentForm({
  request,
  coordinators,
  viewerId,
  onAssigned,
}: {
  request: CoordinationRequest;
  coordinators: Coordinator[];
  viewerId: string | null;
  onAssigned: () => Promise<void>;
}) {
  const unassigned = request.assignedCoordinatorId === null;

  const [assignment, assign, assigning] = useMutation(async (incomingId: string) => {
    await assignEventRequest({
      data: {
        id: request.id,
        coordinatorId: incomingId,
        expectedCoordinatorId: request.assignedCoordinatorId,
      },
    });
    toast.success("Assignment recorded.");
    try {
      await onAssigned();
    } catch {
      // The assignment already committed; a missed refresh must not mask it as an error.
    }
  }, "Could not assign this request. Try again.");

  // PTR-110: an assigned request is offered, not moved. The outgoing Coordinator keeps the
  // request and its access until the incoming one accepts, so the page stays and re-reads itself
  // to show the waiting offer.
  const [handover, requestHandover, requestingHandover] = useMutation(
    async (incomingId: string) => {
      await requestEventHandover({
        data: {
          id: request.id,
          coordinatorId: incomingId,
          expectedCoordinatorId: request.assignedCoordinatorId,
        },
      });
      toast.success("Handover requested.");
      try {
        await onAssigned();
      } catch {
        // The offer already recorded; a missed refresh must not mask it as an error.
      }
    },
    "Could not request this handover. Try again."
  );

  // The coordinator selection, shared by pickup (immediate assignment) and handover (an offer).
  const form = useForm({
    defaultValues: { coordinatorId: "" },
    validators: { onSubmit: CoordinatorSelection },
    onSubmit: async ({ value, formApi }) => {
      if (unassigned) {
        await assign(value.coordinatorId);
        return;
      }
      const result = await requestHandover(value.coordinatorId);
      // Clear the selection only once the offer is recorded: an offer already waits on that
      // Coordinator, and re-submitting the same choice would replace it and email them again.
      if (result.status === "success") formApi.reset();
    },
  });

  const availableCoordinators = coordinators.filter(
    coordinator => coordinator.id !== request.assignedCoordinatorId
  );

  const pendingHandover = request.pendingHandover;

  // One label per state, in precedence order, so the submit button's truth table is readable.
  let submitLabel = "Hand over";
  if (unassigned) submitLabel = assigning ? "Assigning…" : "Assign Coordinator";
  else if (requestingHandover) submitLabel = "Requesting…";
  else if (pendingHandover) submitLabel = "Offer to someone else";

  return (
    <section aria-labelledby="assignment-heading">
      <Card className="max-w-md">
        <CardContent>
          <div>
            <h3 id="assignment-heading" className="display-h3">
              {unassigned ? "Assign this request" : "Hand over this request"}
            </h3>
            <form
              noValidate
              className="mt-4 space-y-3"
              onSubmit={event => {
                event.preventDefault();
                if (assigning || requestingHandover) return;
                void form.handleSubmit();
              }}
            >
              <form.Field name="coordinatorId">
                {field => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={field.name}>Event Coordinator</FieldLabel>
                    <Select
                      value={field.state.value === "" ? null : field.state.value}
                      onValueChange={value => field.handleChange(value ?? "")}
                      disabled={assigning || requestingHandover}
                      required
                    >
                      <SelectTrigger
                        id={field.name}
                        className="w-full"
                        aria-invalid={field.state.meta.errors.length > 0}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue>
                          {(value: string | null) => {
                            const selected = availableCoordinators.find(
                              coordinator => coordinator.id === value
                            );
                            return selected
                              ? coordinatorLabel(selected, viewerId)
                              : "Choose an Event Coordinator";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableCoordinators.map(coordinator => (
                          <SelectItem key={coordinator.id} value={coordinator.id}>
                            {coordinatorLabel(coordinator, viewerId)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={assigning || requestingHandover}>
                  {submitLabel}
                </Button>
                {unassigned && viewerId !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assigning || requestingHandover}
                    onClick={() => {
                      void assign(viewerId);
                    }}
                  >
                    Assign to me
                  </Button>
                )}
              </div>
            </form>
            {unassigned
              ? assignment.status === "error" && (
                  <p role="alert" className="mt-4 body-sm text-destructive">
                    {assignment.error}
                  </p>
                )
              : handover.status === "error" && (
                  <p role="alert" className="mt-4 body-sm text-destructive">
                    {handover.error}
                  </p>
                )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** The waiting cancellation request, for the assigned Coordinator to cancel or decline. */
function CancellationBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request || !isAssignedView(data, request)) return null;
  if (request.status === "cancelled") return null;
  if (!request.cancellationRequests.some(item => item.outcome === null)) return null;
  return (
    <div>
      <h2 className="display-h3">Cancellation request</h2>
      <div className="mt-4">
        <CancellationDecision
          requestId={request.id}
          eventName={request.eventName.trim() || "this event"}
          canCancel={canRequestEventCancellation(request.status)}
        />
      </div>
    </div>
  );
}

/** The confirmation action for a plannable assigned event; triage has no event to confirm. */
function ConfirmBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const { event } = data.event;
  return (
    <div>
      <h2 className="display-h3">Confirm event</h2>
      <div className="mt-4">
        <ConfirmEventAction eventId={event.id} eventName={event.name ?? "this event"} />
      </div>
    </div>
  );
}

/** The completion action for a confirmed assigned event; triage has no event to complete. */
function CompleteBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const { event } = data.event;
  return (
    <div>
      <h2 className="display-h3">Complete event</h2>
      <div className="mt-4">
        <CompleteEventAction
          eventId={event.id}
          eventName={event.name ?? "this event"}
          disabledReason={event.completionUnavailableReason}
        />
      </div>
    </div>
  );
}

/** What the cancelled event still holds, as the old coordination detail lists it. */
function ReleasesBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request?.outstandingReleases) return null;
  return <OutstandingReleasesList releases={request.outstandingReleases} />;
}

function coordinatorLabel(coordinator: Coordinator, viewerId: string | null) {
  return `${coordinator.name} (${coordinator.email})${coordinator.id === viewerId ? " — you" : ""}`;
}
