import { Card, CardContent } from "#/components/ui/card";
import { EventChangeRequestForm } from "#/features/event-requests/components/event-change-request-form";
import {
  RequestCancellationAction,
  UNASSIGNED_CANCELLATION_NOTE,
  cancellationStatusNote,
} from "#/features/event-requests/components/request-cancellation-action";
import {
  CancellationRequestHistory,
  ChangeRequestHistory,
  ClarificationThread,
} from "#/features/event-requests/components/request-message-blocks";
import {
  ASSIGNED_ON_SUBMIT,
  NOT_YET_ASSIGNED,
} from "#/features/event-requests/components/request-list-page";
import {
  canRaiseEventChangeRequest,
  canRequestEventCancellation,
  EVENT_REQUEST_STATUS_STAGES,
} from "#/features/event-requests/schema";
import { formatInstant } from "#/features/event-requests/format";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The Organiser's recorded decision and request history: the decision once it stands, then the
 * clarification answers, change requests, and the cancellation record. A draft has no history,
 * so the message block drops out.
 */
export function organiserRequestSections(data: EventPageData): EventSectionDef[] {
  if (data.kind !== "event" || data.event.access !== "organiser") return [];
  return [
    {
      id: "decision",
      label: "Recorded decision",
      visible: inner =>
        inner.kind === "event" &&
        EVENT_REQUEST_STATUS_STAGES[inner.event.event.status].decided &&
        inner.organiserRequest !== null &&
        inner.organiserRequest !== undefined,
      render: inner => <DecisionBody data={inner} />,
    },
    {
      id: "requests",
      label: "Requests & messages",
      visible: inner =>
        inner.kind === "event" &&
        inner.event.event.status !== "draft" &&
        inner.organiserRequest !== null &&
        inner.organiserRequest !== undefined,
      render: inner => <RequestsBody data={inner} />,
    },
  ];
}

/** The decision as recorded: which way it went, who recorded it, when, and why. */
function DecisionBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const request = data.organiserRequest ?? null;
  if (!request) return null;
  const stage = EVENT_REQUEST_STATUS_STAGES[request.status];
  return (
    <Card>
      <CardContent>
        <h2 className="display-h3">Recorded decision</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="eyebrow text-muted-foreground">Decision</dt>
            <dd className="mt-1 body-sm font-medium text-foreground">
              {stage.outcome === "approved" ? "Approved" : "Rejected"}
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-muted-foreground">Decided by</dt>
            <dd className="mt-1 body-sm font-medium text-foreground">
              {request.decidedByCoordinatorName}
            </dd>
          </div>
          <div>
            <dt className="eyebrow text-muted-foreground">Decided at</dt>
            <dd className="mt-1 body-sm font-medium text-foreground">
              {formatInstant(request.decidedAt)}
            </dd>
          </div>
          {request.decisionReason && (
            <div>
              <dt className="eyebrow text-muted-foreground">Reason</dt>
              <dd className="mt-1 body-sm font-medium whitespace-pre-line text-foreground">
                {request.decisionReason}
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * Every affordance the old detail page offers its organiser, with the same status gates: the
 * reply form only on an open question while the request waits on the organiser, the change and
 * cancellation forms only while the event can still change (and no cancellation already waits).
 * The section is always mounted, so the gates live here in the render.
 */
function RequestsBody({ data }: { data: EventPageData }) {
  if (data.kind !== "event") return null;
  const request = data.organiserRequest ?? null;
  if (!request) return null;
  // PTR-53: one request waits at a time, so the action returns once the Coordinator decides.
  const cancellationWaiting = request.cancellationRequests.some(item => item.outcome === null);
  const canRequestChange = canRaiseEventChangeRequest(request.status);
  const canRequestCancellation =
    canRequestEventCancellation(request.status) && !cancellationWaiting;
  // PTR-53 AC3: an unassigned event has no Coordinator to ask yet.
  const coordinatorName = request.coordinator?.name ?? null;

  return (
    <div>
      <h2 className="display-h3">Requests & messages</h2>
      <div className="mt-4 space-y-8">
        <ClarificationThread request={request} replyable />

        {request.changeRequests.length > 0 && (
          <ChangeRequestHistory request={request} viewerIsCoordinator={false} />
        )}

        {request.cancellationRequests.length > 0 && (
          <CancellationRequestHistory request={request} />
        )}

        {canRequestChange && (
          <section aria-labelledby="change-request-heading">
            <Card>
              <CardContent>
                <h2 id="change-request-heading" className="display-h3">
                  Request a change
                </h2>
                <p className="mt-2 body-sm text-muted-foreground">
                  State what should change and the new value you want. The recorded event stays
                  unchanged until a Coordinator processes this request.
                </p>
                <EventChangeRequestForm requestId={request.id} />
              </CardContent>
            </Card>
          </section>
        )}

        {canRequestCancellation && (
          <section aria-labelledby="request-cancellation-heading">
            <Card>
              <CardContent>
                <h2 id="request-cancellation-heading" className="display-h3">
                  Request cancellation
                </h2>
                <p className="mt-2 body-sm text-muted-foreground">
                  {coordinatorName === null
                    ? `Ask for this event to be cancelled. ${UNASSIGNED_CANCELLATION_NOTE}`
                    : `Ask ${coordinatorName} to cancel this event.`}{" "}
                  {cancellationStatusNote(coordinatorName)}
                </p>
                <RequestCancellationAction
                  requestId={request.id}
                  coordinatorName={coordinatorName}
                />
              </CardContent>
            </Card>
          </section>
        )}

        <CoordinatorContact request={request} />
      </div>
    </div>
  );
}

/** PTR-15 criterion 3: the named point of contact and the route to reach them. */
function CoordinatorContact({ request }: { request: EventRequestDetail }) {
  return (
    <Card>
      <CardContent>
        <dl className="grid gap-6 sm:grid-cols-2">
          <div>
            <dt className="eyebrow text-muted-foreground">Coordinator</dt>
            <dd className="mt-1 body-sm font-medium whitespace-pre-line">
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
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
