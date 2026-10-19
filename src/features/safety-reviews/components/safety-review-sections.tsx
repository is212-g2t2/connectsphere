import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { Textarea } from "#/components/ui/textarea";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { formatInstant, formatVenueWindow } from "#/features/event-requests/format";
import { isConfirmableStatus } from "#/features/events/confirmation";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import {
  SAFETY_REVIEW_COMMENTS_MAX,
  SAFETY_REVIEW_DECISIONS,
  SAFETY_REVIEW_STATE_LABELS,
  SAFETY_REVIEW_WITHDRAWN_LABEL,
  SafetyReviewDecisionInput,
} from "#/features/safety-reviews/schema";
import type {
  SafetyReviewDecision,
  SafetyReviewDetail,
  SafetyReviewStage,
} from "#/features/safety-reviews/schema";
import { decideSafetyReview, requestSafetyReReview } from "#/features/safety-reviews/server-fns";
import { formIssues } from "#/features/venue-requests/schema";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * PTR-146 AC3 and AC5: the Safety Officer's half of the universal event page. The section carries
 * the event's arrangement facts (the projection above it), the review, and the decision form. The
 * form sends the fingerprint the page rendered, so a decision against changed arrangements is
 * refused instead of recorded.
 */

const DECISION_LABELS: Record<SafetyReviewDecision, string> = {
  approved: "Approve",
  rejected: "Reject",
  changes_requested: "Request changes",
};

const DECISION_PENDING_LABELS: Record<SafetyReviewDecision, string> = {
  approved: "Approving…",
  rejected: "Rejecting…",
  changes_requested: "Requesting changes…",
};

export function safetySections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event" || data.event.access !== "safety_officer") return [];
  return [
    {
      id: "arrangements",
      label: "Event arrangements",
      visible: () => true,
      render: () => <ArrangementsSection data={data} />,
    },
    {
      id: "safety-review",
      label: "Safety review",
      visible: () => true,
      render: () => <SafetyReviewSection data={data} />,
    },
  ];
}

/**
 * PTR-158 AC1: the assigned Coordinator's one safety action. It shows on an approved or planning
 * event whose review was rejected or asked for changes. The server re-reads every precondition
 * under the event lock, so a stale page only receives the named refusal.
 */
export function safetyReReviewSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event" || data.event.access !== "coordinator") return [];
  const { status, safetyStage } = data.event.event;
  if (!isConfirmableStatus(status)) return [];
  if (safetyStage?.state !== "rejected" && safetyStage?.state !== "changes_requested") return [];
  return [
    {
      id: "safety-re-review",
      label: "Safety re-review",
      visible: () => true,
      render: () => <ReReviewSection stage={safetyStage} eventId={data.event.event.id} />,
    },
  ];
}

/**
 * PTR-158 AC1: ask for a fresh review after a fix the system cannot see. The server rejects the
 * request with a named reason when the event moved on, another Coordinator holds it, a review is
 * pending, the event has started, or the arrangements are not complete. Show that reason and
 * re-read the page.
 */
function ReReviewSection({ stage, eventId }: { stage: SafetyReviewStage; eventId: number }) {
  const router = useRouter();
  const [, request, requesting] = useMutation(async () => {
    try {
      await requestSafetyReReview({ data: { id: eventId } });
    } catch (error) {
      // A refusal usually means the event or its review moved on. Re-read, and report the reason
      // as a toast: the refreshed stage can hide this section, so an inline alert can vanish.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Could not request a safety re-review. Try again."
      );
      await router.invalidate({ filter: skipRootFilter }).catch(() => {
        // Best effort. The toast is already shown.
      });
      throw error;
    }
    toast.success("Safety re-review requested. Every Safety Officer will be notified.");
    await router.invalidate({ filter: skipRootFilter }).catch(() => {
      // The review already exists. A failed refresh must not report it as a failure.
    });
  }, "Could not request a safety re-review. Try again.");

  return (
    <div>
      <h2 className="display-h3">Safety re-review</h2>
      <p className="mt-2 body-sm text-muted-foreground">
        {stage.current
          ? stage.state === "rejected"
            ? "The last safety review was rejected."
            : "The last safety review asked for changes."
          : "The last safety review no longer covers the arrangements."}{" "}
        Request a fresh review after you address the concerns outside the system. Every Safety
        Officer is notified.
      </p>
      <Button type="button" className="mt-4" disabled={requesting} onClick={() => void request()}>
        {requesting ? "Requesting…" : "Request safety re-review"}
      </Button>
    </div>
  );
}

/**
 * PTR-146 AC5: the facts the Safety Officer assesses: the venue and its capacity, the event's
 * layout and facilities, and every equipment line. Venue catalogue attributes read live here, so a
 * catalogue edit never changes the review's fingerprint and still shows on this page.
 */
function ArrangementsSection({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const { event } = data.event;
  const bookingPeriod = event.venue ? formatVenueWindow(event.venue) : "No current approved venue";

  return (
    <div>
      <h2 className="display-h2">Event arrangements</h2>
      <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Fact
          label="Venue"
          value={
            event.venue
              ? `${event.venue.name}, ${event.venue.location}`
              : "No current approved venue"
          }
        />
        <Fact label="Venue capacity" value={String(event.venueCapacity ?? "Not known")} />
        {event.venue ? <Fact label="Booking period" value={bookingPeriod} /> : null}
        <Fact
          label="Expected attendance"
          value={String(event.expectedAttendance ?? "Not stated")}
        />
        <Fact label="Layout" value={event.layout?.trim() || "Not stated"} />
        <Fact
          label="Accessibility"
          value={event.accessibilityRequirements?.trim() || "Not stated"}
        />
        <Fact
          label="Required facilities"
          value={event.requiredFacilities?.trim() || "Not stated"}
        />
      </dl>

      <h3 className="mt-6 display-h3">Equipment</h3>
      {event.equipment === undefined || event.equipment.length === 0 ? (
        <p className="mt-2 body-sm text-muted-foreground">No equipment lines recorded.</p>
      ) : (
        <div className="mt-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Reserved</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {event.equipment.map(line => (
                <TableRow key={line.id}>
                  <TableCell>{line.item}</TableCell>
                  <TableCell>{line.quantity}</TableCell>
                  <TableCell>{arrangementStateLabel(line.arrangementStatus)}</TableCell>
                  <TableCell>{line.reservedQuantity ?? 0}</TableCell>
                  <TableCell>{line.notes?.trim() || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {event.sessionRequirements ? (
        <>
          <h3 className="mt-6 display-h3">Approved session requirements</h3>
          <p className="mt-2 body-sm text-muted-foreground">
            The current booking's own requirements, which the review covers. A change to them
            withdraws this review. The review covers every approved booking; this page shows the
            current one.
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact
              label="Attendance"
              value={String(event.sessionRequirements.expectedAttendance ?? "Not stated")}
            />
            <Fact label="Layout" value={event.sessionRequirements.layout?.trim() || "Not stated"} />
            <Fact
              label="Accessibility"
              value={event.sessionRequirements.accessibilityRequirements?.trim() || "Not stated"}
            />
            <Fact
              label="Facilities"
              value={event.sessionRequirements.requiredFacilities?.trim() || "Not stated"}
            />
          </dl>
        </>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 body-sm">{value}</dd>
    </div>
  );
}

function SafetyReviewSection({ data }: { data: Extract<EventPageData, { kind: "event" }> }) {
  const review = data.safetyReview;
  const eventStatus: EventRequestStatus = data.event.event.status;
  if (review === undefined) {
    return (
      <p className="body-sm text-muted-foreground">
        The safety review could not be read. Reload the page.
      </p>
    );
  }
  if (review === null) {
    return <p className="body-sm text-muted-foreground">This event has no safety review yet.</p>;
  }

  if (review.state === "pending" && review.current) {
    // The handler decides only approved or planning events (PTR-146 AC3). A stale tab on an
    // event that has since moved on states that reason instead of offering buttons that refuse.
    if (eventStatus !== "approved" && eventStatus !== "planning") {
      return (
        <div>
          <h2 className="display-h2">Safety review</h2>
          <p className="mt-2 body-sm text-muted-foreground">
            This event's safety review cannot be decided while its status is{" "}
            {EVENT_REQUEST_STATUS_LABELS[eventStatus].toLowerCase()}.
          </p>
        </div>
      );
    }
    return (
      <div>
        <h2 className="display-h2">Safety review</h2>
        <p className="mt-2 body-sm text-muted-foreground">
          Assess capacity, layout, emergency access and crowd movement. Your comments go to the
          event's Coordinator with the decision.
        </p>
        <DecisionForm review={review} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="display-h2">Safety review</h2>
      {review.state === "pending" ? (
        <p className="mt-2 body-sm text-muted-foreground">
          This review is withdrawn. {SAFETY_REVIEW_WITHDRAWN_LABEL}.
        </p>
      ) : (
        <>
          <p className="mt-2 body-sm">
            {SAFETY_REVIEW_STATE_LABELS[review.state]}
            {review.decidedByName ? ` by ${review.decidedByName}` : ""}
            {review.decidedAt ? ` on ${formatInstant(new Date(review.decidedAt))}` : ""}.
          </p>
          {review.comments ? (
            <p className="mt-2 body-sm whitespace-pre-line text-muted-foreground">
              {review.comments}
            </p>
          ) : null}
          {!review.current ? (
            <p className="mt-2 body-sm text-muted-foreground">
              The arrangements changed after this decision, so a fresh review is needed.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function DecisionForm({ review }: { review: SafetyReviewDetail }) {
  const router = useRouter();
  const form = useForm({
    // The decision has no input of its own: a button sets it, then submits.
    defaultValues: { decision: "" as SafetyReviewDecision | "", comments: "" },
    validators: {
      onSubmit: ({ value }) => {
        const issues = formIssues(SafetyReviewDecisionInput, {
          reviewId: review.id,
          decision: value.decision,
          fingerprint: review.fingerprint,
          comments: value.comments,
        });
        // A decision field has nothing to render its message on. If one ever arrives unset, show
        // it in the form slot instead of a hidden field.
        if (issues?.fields.decision) return { form: issues.fields.decision.message, fields: {} };
        return issues;
      },
    },
    onSubmit: async ({ value, formApi }) => {
      if (value.decision === "") return; // The validator refuses this.
      try {
        await decideSafetyReview({
          data: {
            reviewId: review.id,
            decision: value.decision,
            fingerprint: review.fingerprint,
            comments: value.comments,
          },
        });
      } catch (error) {
        // A refusal usually means the arrangements moved or another Safety Officer decided.
        // Set the message before the re-read; a reload failure must not hide it.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not record this decision. Try again.",
          },
        });
        await router.invalidate({ filter: skipRootFilter }).catch(() => {
          // Best effort. The refusal is already shown.
        });
        return;
      }
      toast.success("Safety review decision recorded.");
      await router.invalidate({ filter: skipRootFilter }).catch(() => {
        // The decision already committed. A failed refresh must not report it as a failure.
      });
    },
  });

  return (
    <form
      noValidate
      className="mt-4 space-y-4"
      onSubmit={event => {
        event.preventDefault();
        // The library has no re-entrancy check. A second click can arrive before React disables
        // the button.
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="comments">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={`safety-review-comments-${review.id}`}>
              Decision comments
            </FieldLabel>
            <Textarea
              id={`safety-review-comments-${review.id}`}
              value={field.state.value}
              maxLength={SAFETY_REVIEW_COMMENTS_MAX}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldDescription>Required when you reject or request changes.</FieldDescription>
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={state => [state.isSubmitting, state.values.decision]}>
        {([isSubmitting, decision]) => (
          <div className="flex flex-wrap gap-3">
            {SAFETY_REVIEW_DECISIONS.map(candidate => (
              <Button
                key={candidate}
                type="button"
                variant={candidate === "rejected" ? "destructive" : "outline"}
                disabled={Boolean(isSubmitting)}
                aria-label={`${DECISION_LABELS[candidate]} this safety review`}
                onClick={() => {
                  form.setFieldValue("decision", candidate);
                  void form.handleSubmit();
                }}
              >
                {isSubmitting && decision === candidate
                  ? DECISION_PENDING_LABELS[candidate]
                  : DECISION_LABELS[candidate]}
              </Button>
            ))}
          </div>
        )}
      </form.Subscribe>

      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? (
            <FieldError>
              <p className="whitespace-pre-line">{onSubmitError}</p>
            </FieldError>
          ) : null
        }
      </form.Subscribe>
    </form>
  );
}
