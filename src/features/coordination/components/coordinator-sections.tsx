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
  takeUpEventRequestForReview,
} from "#/features/coordination/server-fns";
import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import {
  CancellationRequestHistory,
  ChangeRequestHistory,
  ClarificationThread,
} from "#/features/event-requests/components/request-message-blocks";
import { formatProposedWindow } from "#/features/event-requests/format";
import {
  CLARIFICATION_FIELDS,
  CLARIFICATION_TEXT_MAX,
  ClarificationFormSchema,
  canAssignEventRequest,
  canRequestEventCancellation,
  canUpdateEventInformation,
  isReviewStatus,
} from "#/features/event-requests/schema";
import type { ClarificationField, EventRequestStatus } from "#/features/event-requests/schema";
import { ConfirmEventAction } from "#/features/events/components/confirm-event-action";
import { CompleteEventAction } from "#/features/events/components/complete-event-action";
import { isConfirmableStatus } from "#/features/events/confirmation";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";
import { skipRootFilter } from "#/lib/invalidate";

/** A cancellation request with no outcome recorded is still waiting on the Coordinator. */
function hasPendingCancellation(data: EventPageData): boolean {
  return (coordinationRequest(data)?.cancellationRequests ?? []).some(
    item => item.outcome === null
  );
}

function hasChangeHistory(data: EventPageData): boolean {
  return (coordinationRequest(data)?.changeRequests ?? []).length > 0;
}

/** The clarification thread has entries to show, mirroring `MessagesBody`'s null condition. */
function hasClarifications(data: EventPageData): boolean {
  return (coordinationRequest(data)?.clarifications ?? []).length > 0;
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

/** The viewer holds this request exactly when the page is the assigned (event) kind. */
function isAssignedView(data: EventPageData, request: CoordinationRequest): boolean {
  return data.kind === "event" && request.assignedCoordinatorId !== null;
}

/**
 * The Coordinator's review flow: the request record, the decision, the clarification thread, the
 * change requests, and a waiting cancellation request. The unassigned detail (triage) renders the
 * record alone: every action needs an assignee, so those sections stay on the assigned event
 * view (PTR-144). PTR-145 retires the handover, so the Coordinator gets no transfer action.
 * `leadAssignmentSections` carries the Lead's assign and reassign form instead.
 *
 * Gating contract: SectionStack shows only sections whose `visible()` passes, while each body
 * still null-checks its own empty state — tests render bodies directly and bypass `visible()`.
 */
export function coordinatorSections(data: EventPageData): EventSectionDef[] {
  const status = coordinationStatus(data);
  if (status === null) return [];
  // Triage is the unassigned view; only the assigned event view carries the review flow.
  const assignedView = data.kind === "event";
  const inReview = isReviewStatus(status);
  return [
    {
      id: "request",
      label: "Request details",
      // PTR-144: the queue detail reads the record in any status, including a request whose
      // Coordinator account was deleted after a decision. The assigned view keeps it in review.
      visible: () => data.kind === "triage" || inReview,
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
      // PTR-144: the Lead reads the history too; the decisions stay on the assigned view.
      visible: inner => hasChangeHistory(inner),
      render: inner => <ChangesBody data={inner} />,
    },
    {
      id: "cancellation",
      label: "Cancellation request",
      visible: inner =>
        hasPendingCancellation(inner) && coordinationRequest(inner)?.status !== "cancelled",
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
      await router.invalidate({ filter: skipRootFilter });
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
        await router.invalidate({ filter: skipRootFilter });
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
        await router.invalidate({ filter: skipRootFilter });
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
  // While the decisions card shows the waiting requests, the history below keeps only the
  // decided ones so no request renders twice. The Organiser's record keeps the full list.
  const history = processing
    ? { ...request, changeRequests: request.changeRequests.filter(item => item.outcome !== null) }
    : request;
  return (
    <div className="space-y-8">
      {processing && <ChangeRequestDecisions request={request} />}
      {processing && !canUpdateEventInformation(request.status) && (
        <CoordinatorInformationForm request={request} />
      )}
      {history.changeRequests.length > 0 && (
        <ChangeRequestHistory
          request={history}
          viewerIsCoordinator={isAssignedView(data, request)}
        />
      )}
    </div>
  );
}

/**
 * PTR-145: the Lead's assignment form. It renders on the unassigned queue detail and on an
 * assigned event, and it offers every Event Coordinator, unfiltered and unranked (criterion 6).
 * A move takes effect at once, and the server refuses a stale observation (criterion 8).
 */
export function leadAssignmentSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    return [
      {
        id: "assignment",
        label: "Assign Coordinator",
        visible: () => canAssignEventRequest(data.request.status),
        render: () => (
          <LeadAssignmentBody request={data.request} coordinators={data.coordinators} />
        ),
      },
    ];
  }
  // Only the Lead's event page carries the coordination read and an assignment form.
  if (data.event.access !== "lead" || !data.coordination) return [];
  const { request, coordinators } = data.coordination;
  return [
    {
      id: "assignment",
      label: "Assign Coordinator",
      visible: () => canAssignEventRequest(request.status),
      render: () => <LeadAssignmentBody request={request} coordinators={coordinators} />,
    },
  ];
}

/**
 * The Lead's one assignment action, as the queue detail and an assigned event show it. The
 * current holder rides the summary above the form so a reassignment states what it replaces.
 */
function LeadAssignmentBody({
  request,
  coordinators,
}: {
  request: CoordinationRequest;
  coordinators: Coordinator[];
}) {
  const router = useRouter();
  const reassigning = request.assignedCoordinatorId !== null;
  const [result, assign, assigning] = useMutation(async (coordinatorId: string) => {
    await assignEventRequest({
      data: {
        id: request.id,
        coordinatorId,
        expectedCoordinatorId: request.assignedCoordinatorId,
      },
    });
    toast.success(reassigning ? "Coordinator reassigned." : "Coordinator assigned.");
    try {
      await router.invalidate({ filter: skipRootFilter });
    } catch {
      // The move already committed; a missed refresh must not mask it as an error.
    }
  }, "Could not assign this Coordinator. Try again.");

  const form = useForm({
    defaultValues: { coordinatorId: "" },
    validators: { onSubmit: CoordinatorSelection },
    onSubmit: async ({ value, formApi }) => {
      const outcome = await assign(value.coordinatorId);
      // Clear the selection only once the move is recorded.
      if (outcome.status === "success") formApi.reset();
    },
  });

  return (
    <div>
      <h2 className="display-h3">Assign a Coordinator</h2>
      <Card className="mt-4 max-w-md">
        <CardContent>
          <dl className="grid gap-4">
            <Record
              label="Current Coordinator"
              value={
                request.coordinator ? (
                  <>
                    {request.coordinator.name}
                    <br />
                    <a href={`mailto:${request.coordinator.email}`} className={NAV_LINK_CLASSNAME}>
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
          </dl>
          <form
            noValidate
            className="mt-4 space-y-3"
            onSubmit={event => {
              event.preventDefault();
              if (assigning) return;
              void form.handleSubmit();
            }}
          >
            <form.Field name="coordinatorId">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="lead-assignment-coordinator">Event Coordinator</FieldLabel>
                  <Select
                    value={field.state.value === "" ? null : field.state.value}
                    onValueChange={value => field.handleChange(value ?? "")}
                    disabled={assigning}
                    required
                  >
                    <SelectTrigger
                      id="lead-assignment-coordinator"
                      className="w-full"
                      aria-invalid={field.state.meta.errors.length > 0}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue>
                        {(value: string | null) => {
                          const selected = coordinators.find(
                            coordinator => coordinator.id === value
                          );
                          return selected
                            ? coordinatorOptionLabel(selected)
                            : "Choose an Event Coordinator";
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {coordinators.map(coordinator => (
                        <SelectItem key={coordinator.id} value={coordinator.id}>
                          {coordinatorOptionLabel(coordinator)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <Button type="submit" disabled={assigning}>
              {assigning
                ? "Assigning…"
                : reassigning
                  ? "Reassign Coordinator"
                  : "Assign Coordinator"}
            </Button>
          </form>
          {result.status === "error" && (
            <p role="alert" className="mt-4 body-sm text-destructive">
              {result.error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function coordinatorOptionLabel(coordinator: Coordinator) {
  return `${coordinator.name} (${coordinator.email})`;
}

/**
 * The waiting cancellation request. The assigned Coordinator decides it; the Lead reads the same
 * record as history, with no action (PTR-144).
 */
function CancellationBody({ data }: { data: EventPageData }) {
  const request = coordinationRequest(data);
  if (!request) return null;
  if (request.status === "cancelled") return null;
  if (!request.cancellationRequests.some(item => item.outcome === null)) return null;
  if (!isAssignedView(data, request)) return <CancellationRequestHistory request={request} />;
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
