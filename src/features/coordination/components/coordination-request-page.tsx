import { useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { unwrapRefusal } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
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
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import { formatInstant } from "#/features/event-requests/format";
import { ClarificationFormSchema } from "#/features/event-requests/schema";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function CoordinationRequestPage({
  request,
  coordinators,
  user,
}: {
  request: CoordinationRequest;
  coordinators: Coordinator[];
  user: SessionUser;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const unassigned = request.assignedCoordinatorId === null;

  const [assignment, assign, assigning] = useMutation(async (incomingId: string) => {
    await unwrapRefusal(
      assignEventRequest({
        data: {
          id: request.id,
          coordinatorId: incomingId,
          expectedCoordinatorId: request.assignedCoordinatorId,
        },
      }),
      "Could not assign this request. Try again."
    );
    toast.success("Assignment recorded.");
    // Leave the old detail immediately: the actor may have just relinquished access to it.
    await navigate({ to: "/coordination" });
  }, "Could not assign this request. Try again.");

  // AC3: the assigned Coordinator moves a submitted request into review. Re-enter through the
  // list, same as `assign` above, so the page never has to reconcile a stale `request` prop
  // against the new status itself.
  const [review, takeUpReview, takingUp] = useMutation(async () => {
    await unwrapRefusal(
      takeUpEventRequestForReview({ data: { id: request.id } }),
      "Could not take up this request for review. Try again."
    );
    toast.success("Request taken up for review.");
    await navigate({ to: "/coordination" });
  }, "Could not take up this request for review. Try again.");

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
        await unwrapRefusal(
          decideEventRequest({ data: input }),
          "Could not record this decision. Try again."
        );
        toast.success(input.decision === "approved" ? "Request approved." : "Request rejected.");
        await navigate({ to: "/coordination" });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not record this decision. Try again.",
          },
        });
      }
    },
  });

  function submitDecision(decision: "approved" | "rejected") {
    decisionForm.setFieldValue("decision", decision);
    void decisionForm.handleSubmit();
  }

  const clarificationForm = useForm({
    defaultValues: { body: "" },
    validators: { onSubmit: ClarificationFormSchema },
    onSubmit: async ({ value, formApi }) => {
      try {
        await unwrapRefusal(
          raiseClarificationRequest({
            data: {
              id: request.id,
              body: value.body,
            },
          }),
          "Could not send clarification request. Try again."
        );
        toast.success("Clarification request sent.");
        clarificationForm.reset();
        await router.invalidate();
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
      }
    },
  });

  const form = useForm({
    defaultValues: { coordinatorId: "" },
    validators: { onSubmit: CoordinatorSelection },
    onSubmit: async ({ value }) => {
      await assign(value.coordinatorId);
    },
  });

  const availableCoordinators = coordinators.filter(
    coordinator => coordinator.id !== request.assignedCoordinatorId
  );

  const canTakeUpForReview =
    request.status === "submitted" && request.assignedCoordinatorId === user.id;
  const canDecide = request.status === "under_review" && request.assignedCoordinatorId === user.id;
  const canAssign =
    request.status !== "draft" && request.status !== "approved" && request.status !== "rejected";

  const canRequestClarification =
    (request.status === "under_review" || request.status === "awaiting_organiser") &&
    request.assignedCoordinatorId === user.id;

  return (
    <EventRequestDetailPage
      request={request}
      back={{ to: "/coordination", label: "Back to coordination" }}
    >
      {canTakeUpForReview && (
        <section className="mt-8" aria-labelledby="review-heading">
          <Card>
            <CardContent>
              <h2 id="review-heading" className="display-h3">
                Take up for review
              </h2>
              <p className="mt-2 body-sm text-muted-foreground">
                Move this request into review once you're ready to assess it.
              </p>
              <Button
                type="button"
                className="mt-4"
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
      )}

      {canDecide && (
        <section className="mt-8" aria-labelledby="decision-heading">
          <Card>
            <CardContent>
              <h2 id="decision-heading" className="display-h3">
                Record a decision
              </h2>
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
      )}

      {canRequestClarification && (
        <section className="mt-8" aria-labelledby="clarification-heading">
          <Card>
            <CardContent>
              <h2 id="clarification-heading" className="display-h3">
                Request clarification
              </h2>
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
      )}

      {canAssign && (
        <section className="mt-8" aria-labelledby="assignment-heading">
          <Card>
            <CardContent>
              <h2 id="assignment-heading" className="display-h3">
                {unassigned ? "Assign this request" : "Reassign this request"}
              </h2>
              <p className="mt-2 body-sm text-muted-foreground">
                Organiser: {request.organiser.name} —{" "}
                <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
                  {request.organiser.email}
                </a>
              </p>
              {!unassigned && (
                <p className="mt-2 body-sm text-muted-foreground">
                  Assigned on {formatInstant(request.assignedAt)}. Handing this request over removes
                  your coordination access.
                </p>
              )}
              <form
                noValidate
                className="mt-5 space-y-3"
                onSubmit={event => {
                  event.preventDefault();
                  if (assigning) return;
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
                        disabled={assigning}
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
                                ? coordinatorLabel(selected, user.id)
                                : "Choose an Event Coordinator";
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {availableCoordinators.map(coordinator => (
                            <SelectItem key={coordinator.id} value={coordinator.id}>
                              {coordinatorLabel(coordinator, user.id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={assigning}>
                    {assigning
                      ? "Assigning…"
                      : unassigned
                        ? "Assign Coordinator"
                        : "Reassign Coordinator"}
                  </Button>
                  {unassigned && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={assigning}
                      onClick={() => {
                        void assign(user.id);
                      }}
                    >
                      Assign to me
                    </Button>
                  )}
                </div>
              </form>
              {assignment.status === "error" && (
                <p role="alert" className="mt-4 body-sm text-destructive">
                  {assignment.error}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </EventRequestDetailPage>
  );
}

function coordinatorLabel(coordinator: Coordinator, currentUserId: string) {
  return `${coordinator.name} (${coordinator.email})${coordinator.id === currentUserId ? " — you" : ""}`;
}
