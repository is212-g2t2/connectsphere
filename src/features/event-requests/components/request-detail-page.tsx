import { Link } from "@tanstack/react-router";

import {
  EventRequestStatusBadge,
  NOT_YET_ASSIGNED,
  UNTITLED_REQUEST,
} from "#/features/event-requests/components/request-list-page";
import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";
import type { EventRequestSummary } from "#/features/event-requests/server-fns";
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
export function EventRequestDetailPage({ request }: { request: EventRequestSummary }) {
  const title = request.eventName.trim() || UNTITLED_REQUEST;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/event-requests" className={NAV_LINK_CLASSNAME}>
        Back to event requests
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
        <EventRequestStatusBadge status={request.status} />
      </div>
      <p className="mt-3 max-w-xl text-muted-foreground">
        {request.status === "draft" ? (
          "Saved as a draft and not yet submitted."
        ) : (
          <>
            Submitted on{" "}
            <time dateTime={request.submittedAt?.toISOString()}>
              {formatInstant(request.submittedAt)}
            </time>
            . It is with ConnectSphere for review.
          </>
        )}
      </p>

      <dl className="mt-10 grid gap-6 sm:grid-cols-2">
        <Detail term="Coordinator">
          <span className="text-muted-foreground">{NOT_YET_ASSIGNED}</span>
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
    </main>
  );
}

/**
 * An instant the server recorded, unlike the wall-clock strings above. Rendered in one fixed
 * zone rather than the runtime's: the page is server-rendered and then hydrated, and a zone that
 * differed between the two would change the text under React's feet. ConnectSphere's venues are
 * in Singapore (brief §1), so that is the zone; the `<time>` element carries the exact instant.
 */
function formatInstant(value: Date | null): string {
  return value === null
    ? "an unknown date"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Singapore",
      }).format(value);
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
      <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{term}</dt>
      <dd className="mt-2 text-sm font-medium whitespace-pre-line">{children}</dd>
    </div>
  );
}
