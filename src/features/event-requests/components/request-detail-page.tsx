import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import {
  ASSIGNED_ON_SUBMIT,
  NOT_YET_ASSIGNED,
  UNTITLED_REQUEST,
} from "#/features/event-requests/components/request-list-page";
import { ClarificationReplyForm } from "#/features/event-requests/components/clarification-reply-form";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { toDraftValues } from "#/features/event-requests/components/request-page";
import {
  CLARIFICATION_FIELDS,
  EVENT_REQUEST_STATUS_LABELS,
  EVENT_REQUEST_STATUS_STAGES,
} from "#/features/event-requests/schema";
import type {
  ClarificationAmendmentValue,
  ClarificationField,
} from "#/features/event-requests/schema";
import {
  formatInstant,
  formatLocalDateTime,
  formatProposedWindow,
} from "#/features/event-requests/format";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const NONE = "None recorded";

/**
 * One request as currently recorded, read-only (PTR-14 criterion 4). Every field the form
 * captures is shown under the label the form gave it, so an organiser can check what
 * ConnectSphere holds against what they typed.
 *
 * A draft is shown the same way for now. Reopening a draft into the form on this page is
 * PTR-12, which swaps the draft branch here for `EventRequestForm`.
 */
export function EventRequestDetailPage({
  request,
  back,
  children,
  showReplyForms = false,
}: {
  request: EventRequestDetail;
  back?: { to: "/event-requests" | "/coordination"; label: string };
  children?: React.ReactNode;
  /** The Organiser's own screen opts in; the Coordinator's shared read-only view must not reply. */
  showReplyForms?: boolean;
}) {
  const title = request.eventName.trim() || UNTITLED_REQUEST;
  const stage = EVENT_REQUEST_STATUS_STAGES[request.status];
  // A cancelled request keeps whatever decision it had, so the record decides, not the status.
  const hasDecision = stage.decided || request.decidedAt !== null;
  /**
   * One signature of the values a reply may amend. A reply by one question's form reloads this page
   * for the next one; a form left mounted would keep the snapshot from before that reply, so the
   * key remounts it with the values just loaded. Fields with no row-level representation (the reply
   * body) belong to a mount, not to this signature.
   */
  const replyValues = toDraftValues(request);
  const replyValuesKey = JSON.stringify(replyValues);

  return (
    <Page width="page">
      <Link to={back?.to ?? "/event-requests"} className={NAV_LINK_CLASSNAME}>
        {back?.label ?? "Back to event requests"}
      </Link>

      <PageHeader
        title={title}
        actions={<EventRequestStatusBadge status={request.status} />}
        description={
          request.status === "draft" ? (
            stage.note
          ) : hasDecision ? (
            <>
              Decision recorded on{" "}
              <time dateTime={request.decidedAt?.toISOString()}>
                {formatInstant(request.decidedAt)}
              </time>
              .{stage.note && ` ${stage.note}`}
            </>
          ) : (
            <>
              Submitted on{" "}
              <time dateTime={request.submittedAt?.toISOString()}>
                {formatInstant(request.submittedAt)}
              </time>
              . {stage.note}
            </>
          )
        }
      />

      {children}

      {hasDecision && (
        <Card className="mt-8">
          <CardContent>
            <h2 className="display-h3">Recorded decision</h2>
            <dl className="mt-5 grid gap-6 sm:grid-cols-2">
              <Detail term="Decision">
                {stage.outcome
                  ? EVENT_REQUEST_STATUS_LABELS[stage.outcome]
                  : // The row keeps who decided and when, not which way; say so rather than
                    // present the cancellation as the decision.
                    "Cancelled after a recorded decision"}
              </Detail>
              <Detail term="Decided by">{request.decidedByCoordinatorName ?? NONE}</Detail>
              <Detail term="Decided at">
                <time dateTime={request.decidedAt?.toISOString()}>
                  {formatInstant(request.decidedAt)}
                </time>
              </Detail>
              <Detail term="Reason" wide>
                {request.decisionReason || NONE}
              </Detail>
            </dl>
          </CardContent>
        </Card>
      )}

      {request.clarifications.length > 0 && (
        <section className="mt-8" aria-labelledby="clarifications-heading">
          <Card>
            <CardContent>
              <h2 id="clarifications-heading" className="display-h3">
                Clarification requests
              </h2>
              <p className="mt-2 body-sm text-muted-foreground">
                Questions or additional details requested by the Event Coordinator.
              </p>
              <ul className="mt-4 divide-y divide-border">
                {request.clarifications.map((item, index) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="eyebrow text-muted-foreground">Request #{index + 1}</span>
                      <time
                        dateTime={item.createdAt.toISOString()}
                        className="body-sm text-muted-foreground"
                      >
                        {formatInstant(item.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 body-md font-medium whitespace-pre-line text-foreground">
                      {item.body}
                    </p>
                    {item.replyBody ? (
                      <div className="mt-4 border-l-2 border-border pl-4">
                        <p className="eyebrow text-muted-foreground">Organiser reply</p>
                        <p className="mt-2 body-md whitespace-pre-line text-foreground">
                          {item.replyBody}
                        </p>
                        {item.repliedAt && (
                          <time
                            dateTime={item.repliedAt.toISOString()}
                            className="mt-2 block body-sm text-muted-foreground"
                          >
                            {formatInstant(item.repliedAt)}
                          </time>
                        )}
                        {item.amendments.map(amendment => (
                          <p key={amendment.field} className="mt-2 body-sm text-foreground">
                            <span className="font-medium">
                              {clarificationFieldLabel(amendment.field)}:
                            </span>{" "}
                            {formatAmendmentValue(amendment.field, amendment.from)} →{" "}
                            {formatAmendmentValue(amendment.field, amendment.to)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      showReplyForms &&
                      (request.status === "awaiting_organiser" ||
                        request.status === "under_review") && (
                        <div className="mt-4 border-t border-border pt-4">
                          <h3 className="display-h3">Reply to clarification</h3>
                          <ClarificationReplyForm
                            key={`${item.id}:${replyValuesKey}`}
                            requestId={request.id}
                            clarification={item}
                            initialValues={replyValues}
                          />
                        </div>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      <Card className="mt-8">
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-2">
            {/* PTR-15 criterion 3: the named point of contact and the route to reach them. */}
            <Detail term="Coordinator">
              {request.coordinator ? (
                <>
                  {request.coordinator.name}
                  <br />
                  <a href={`mailto:${request.coordinator.email}`} className={NAV_LINK_CLASSNAME}>
                    {request.coordinator.email}
                  </a>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {request.status === "draft" ? ASSIGNED_ON_SUBMIT : NOT_YET_ASSIGNED}
                </span>
              )}
            </Detail>
            <Detail term="Expected attendance">{request.expectedAttendance ?? NONE}</Detail>

            <Detail term="Purpose" wide>
              {request.purpose || NONE}
            </Detail>

            <Detail term="Proposed dates and times" wide>
              {request.proposedDates.length === 0 ? (
                NONE
              ) : (
                <ul className="space-y-1">
                  {request.proposedDates.map(window => (
                    // A window is its own identity here: the list is read-only, so two identical
                    // lines sharing a key cost a warning in dev and nothing else.
                    <li key={`${window.start ?? ""}-${window.end ?? ""}`}>
                      {formatProposedWindow(window)}
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail term="Type of event">{request.eventType || NONE}</Detail>
            <Detail term="Room-layout preference">{request.roomLayoutPreference || NONE}</Detail>
            <Detail term="Description" wide>
              {request.description || NONE}
            </Detail>
            <Detail term="Venue requirements" wide>
              {request.venueRequirements || NONE}
            </Detail>
            <Detail term="Accessibility requirements" wide>
              {request.accessibilityRequirements || NONE}
            </Detail>
            <Detail term="Special arrangements" wide>
              {request.specialArrangements || NONE}
            </Detail>

            <Detail term="Equipment requirements" wide>
              {request.equipmentRequirements.length === 0 ? (
                NONE
              ) : (
                <ul className="space-y-1">
                  {request.equipmentRequirements.map(line => (
                    // Same as the proposed dates: read-only, so two identical lines sharing a key is a
                    // dev-mode warning and nothing more.
                    <li key={`${line.type}-${line.quantity ?? ""}`}>
                      {line.type || "Unnamed equipment"}
                      {line.quantity === undefined ? "" : ` × ${line.quantity}`}
                    </li>
                  ))}
                </ul>
              )}
            </Detail>

            <Detail term="Attendee registration" wide>
              {request.registrationEnabled ? (
                <ul className="space-y-1">
                  <li>Capacity {request.registrationCapacity}</li>
                  <li>
                    Opens {formatLocalDateTime(request.registrationOpensAt ?? "")}, closes{" "}
                    {formatLocalDateTime(request.registrationClosesAt ?? "")}
                  </li>
                </ul>
              ) : (
                "Not required"
              )}
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </Page>
  );
}

const CLARIFICATION_FIELD_LABELS = new Map(
  CLARIFICATION_FIELDS.map(field => [field.key, field.label])
);

function clarificationFieldLabel(field: ClarificationField): string {
  return CLARIFICATION_FIELD_LABELS.get(field) ?? field;
}

/** A `jsonb` value is plain JSON, so an object is narrowed by hand before its keys are read. */
function isObjectValue(
  value: ClarificationAmendmentValue
): value is Record<string, ClarificationAmendmentValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringOrUndefined(value: ClarificationAmendmentValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrNull(value: ClarificationAmendmentValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

/** A leaf, or the JSON of anything nested, so an unexpected shape is never shown as `[object Object]`. */
function plainAmendmentText(value: ClarificationAmendmentValue): string {
  if (value === null || value === "") return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * One amended value as a reader sees it, per field kind. The field name is what decides the shape:
 * a proposed window, an equipment line, or the four columns an attendee-registration amendment spans.
 */
function formatAmendmentValue(
  field: ClarificationField,
  value: ClarificationAmendmentValue
): string {
  if (value === null) return "None";

  switch (field) {
    case "proposedDates":
      if (!Array.isArray(value)) return plainAmendmentText(value);
      return value
        .map(window =>
          isObjectValue(window)
            ? formatProposedWindow({
                start: stringOrUndefined(window.start),
                end: stringOrUndefined(window.end),
              })
            : plainAmendmentText(window)
        )
        .join("; ");
    case "equipmentRequirements":
      if (!Array.isArray(value)) return plainAmendmentText(value);
      return value
        .map(line => {
          if (!isObjectValue(line)) return plainAmendmentText(line);
          const type = stringOrUndefined(line.type) ?? "";
          const quantity = numberOrNull(line.quantity);
          return `${type || "Unnamed equipment"} × ${quantity ?? "?"}`;
        })
        .join("; ");
    case "attendeeRegistration": {
      if (!isObjectValue(value)) return plainAmendmentText(value);
      const opens = stringOrUndefined(value.registrationOpensAt) ?? null;
      const closes = stringOrUndefined(value.registrationClosesAt) ?? null;
      const capacity = numberOrNull(value.registrationCapacity);
      return `Capacity ${capacity ?? "None"}; opens ${
        opens === null ? "None" : formatLocalDateTime(opens)
      }, closes ${closes === null ? "None" : formatLocalDateTime(closes)}`;
    }
    default:
      return plainAmendmentText(value);
  }
}

function Detail({
  term,
  wide = false,
  children,
}: {
  term: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="eyebrow text-muted-foreground">{term}</dt>
      <dd className="mt-2 body-md font-medium whitespace-pre-line">{children}</dd>
    </div>
  );
}
