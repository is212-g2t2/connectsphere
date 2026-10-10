import { Card, CardContent } from "#/components/ui/card";
import { ClarificationReplyForm } from "#/features/event-requests/components/clarification-reply-form";
import { toDraftValues } from "#/features/event-requests/components/request-page";
import { cancellationStatusNote } from "#/features/event-requests/components/request-cancellation-action";
import {
  clarificationAmendmentKeys,
  clarificationFieldLabel,
} from "#/features/event-requests/schema";
import type {
  ClarificationAmendmentValue,
  ClarificationField,
  EventRequestDraftValues,
} from "#/features/event-requests/schema";
import {
  formatInstant,
  formatLocalDateTime,
  formatProposedWindow,
} from "#/features/event-requests/format";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";

/**
 * The clarification thread, change-request history, and cancellation-request history the
 * Organiser's detail page and the universal event page share. The detail page keeps its own
 * opt-in flags; the event page section passes `replyable` and renders the forms itself.
 */
export function ClarificationThread({
  request,
  replyable,
}: {
  request: EventRequestDetail;
  /** Whether the reader may answer an open question (the Organiser's own screens only). */
  replyable: boolean;
}) {
  const replyValues = toDraftValues(request);
  return (
    <section aria-labelledby="clarifications-heading">
      <Card>
        <CardContent>
          <h2 id="clarifications-heading" className="display-h3">
            Clarification requests
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            Questions or additional details requested by the Event Coordinator.
          </p>
          {request.clarifications.length === 0 ? (
            <p className="mt-4 body-sm text-muted-foreground">No clarification requests.</p>
          ) : (
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
                    replyable &&
                    (request.status === "awaiting_organiser" ||
                      request.status === "under_review") && (
                      <div className="mt-4 border-t border-border pt-4">
                        <h3 className="display-h3">Reply to clarification</h3>
                        <ClarificationReplyForm
                          key={`${item.id}:${replyValuesSignature(item.permittedFields, replyValues)}`}
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
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function ChangeRequestHistory({
  request,
  viewerIsCoordinator,
}: {
  request: EventRequestDetail;
  /** The assigned Coordinator reads "Waiting for your decision."; everyone else reads the name. */
  viewerIsCoordinator: boolean;
}) {
  const coordinatorName = request.coordinator?.name ?? null;
  return (
    <section aria-labelledby="change-requests-heading">
      <Card>
        <CardContent>
          <h2 id="change-requests-heading" tabIndex={-1} className="display-h3 outline-none">
            Change requests
          </h2>
          <ul className="mt-4 divide-y divide-border">
            {request.changeRequests.map((item, index) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-muted-foreground">Change request #{index + 1}</span>
                  <time
                    dateTime={item.createdAt.toISOString()}
                    className="body-sm text-muted-foreground"
                  >
                    {formatInstant(item.createdAt)}
                  </time>
                </div>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Detail term="What should change">{item.whatShouldChange}</Detail>
                  <Detail term="Requested new value">{item.requestedValue}</Detail>
                </dl>
                <p className="mt-3 body-md font-medium">
                  {changeRequestOutcome(item, coordinatorName, viewerIsCoordinator)}
                </p>
                {item.declineReason ? (
                  <div className="mt-3 border-l-2 border-border pl-4">
                    <p className="eyebrow text-muted-foreground">Reason</p>
                    <p className="mt-1 body-md whitespace-pre-line">{item.declineReason}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function CancellationRequestHistory({ request }: { request: EventRequestDetail }) {
  // PTR-53 AC3: an unassigned event has no Coordinator to ask yet.
  const coordinatorName = request.coordinator?.name ?? null;
  return (
    <section aria-labelledby="cancellation-requests-heading">
      <Card>
        <CardContent>
          <h2 id="cancellation-requests-heading" className="display-h3">
            Cancellation requests
          </h2>
          <ul className="mt-4 divide-y divide-border">
            {request.cancellationRequests.map((item, index) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-muted-foreground">
                    Cancellation request #{index + 1}
                  </span>
                  <time
                    dateTime={item.createdAt.toISOString()}
                    className="body-sm text-muted-foreground"
                  >
                    {formatInstant(item.createdAt)}
                  </time>
                </div>
                <p className="mt-2 body-md font-medium">
                  {cancellationOutcome(item, coordinatorName)}
                </p>
                {item.declineReason ? (
                  <div className="mt-3 border-l-2 border-border pl-4">
                    <p className="eyebrow text-muted-foreground">Reason</p>
                    <p className="mt-1 body-md whitespace-pre-line">{item.declineReason}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function Detail({
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
      <dd className="mt-2 body-sm whitespace-pre-line">{children}</dd>
    </div>
  );
}

/**
 * A reply form's remount key: JSON of only the draft columns its own question's permitted fields
 * cover. A reply to one open question reloads this page and refreshes every form's `initialValues`,
 * but only the submitted question's fields actually changed. Scoping the signature to a question's
 * own fields means a sibling's still-open form only remounts (and loses unsaved input) when a value
 * it could itself amend changed underneath it — not on every reply on the page.
 */
function replyValuesSignature(
  permittedFields: readonly ClarificationField[],
  values: EventRequestDraftValues
): string {
  const keys = new Set(permittedFields.flatMap(clarificationAmendmentKeys));
  const subset = Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
  return JSON.stringify(subset);
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

/** PTR-52 AC5: what became of one change request, and who processed it when. */
function changeRequestOutcome(
  item: EventRequestDetail["changeRequests"][number],
  coordinatorName: string | null,
  viewerIsCoordinator: boolean
): string {
  if (item.outcome === null) {
    if (coordinatorName === null) return "Waiting for a Coordinator to be assigned.";
    if (viewerIsCoordinator) return "Waiting for your decision.";
    return `Waiting for ${coordinatorName} to process it.`;
  }
  if (item.outcome === "applied") {
    return `Applied by ${processedBy(item)}. The event information shows the new values.`;
  }
  return `Declined by ${processedBy(item)}.`;
}

/** PTR-54 AC7, AC8: what became of one cancellation request, and who decided it when. */
function cancellationOutcome(
  item: EventRequestDetail["cancellationRequests"][number],
  coordinatorName: string | null
): string {
  if (item.outcome === null) return `Waiting. ${cancellationStatusNote(coordinatorName)}`;
  if (item.outcome === "cancelled") return `Event cancelled by ${processedBy(item)}.`;
  return `Declined by ${processedBy(item)}.`;
}

/** Who processed a decided request and when, shared by the change and cancellation records. */
function processedBy(item: { processedByName: string | null; processedAt: Date | null }): string {
  return `${item.processedByName ?? "the Coordinator"} on ${formatInstant(item.processedAt)}`;
}
