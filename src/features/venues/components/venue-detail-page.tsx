import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { VenueRequestPanel } from "#/features/venue-requests/components/venue-request-panel";
import type { VenueRequestPrefill } from "#/features/venue-requests/schema";
import { formatPeriod } from "#/features/emails/format";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import type { RoomLayout, VenueSearch } from "#/features/venues/schema";
import type { VenueWithConflicts } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * Rebuild the venue search that led here, so the back link returns to the filtered results. The
 * detail route carries the request form's names (`accessibilityRequirements`, `requiredFacilities`);
 * the search uses the shorter names (`accessibility`, `facilities`).
 */
export function venueSearchFromPrefill(
  eventId: number | undefined,
  prefill: VenueRequestPrefill | null | undefined
): VenueSearch {
  return {
    ...(eventId === undefined ? {} : { eventId }),
    ...(prefill?.date === undefined ? {} : { date: prefill.date }),
    ...(prefill?.startTime === undefined ? {} : { startTime: prefill.startTime }),
    ...(prefill?.endTime === undefined ? {} : { endTime: prefill.endTime }),
    ...(prefill?.expectedAttendance === undefined
      ? {}
      : { expectedAttendance: prefill.expectedAttendance }),
    ...(prefill?.layout ? { layout: prefill.layout } : {}),
    ...(prefill?.accessibilityRequirements
      ? { accessibility: prefill.accessibilityRequirements }
      : {}),
    ...(prefill?.requiredFacilities ? { facilities: prefill.requiredFacilities } : {}),
  };
}

/**
 * Show one venue record. Holders of `venue:update` can edit it. Other admitted roles see it
 * read-only. A Coordinator from an event search also sees PTR-31's request panel. The loader
 * supplies a context only for the caller's own event.
 *
 * Pass the row, session, and just-created flag as props, not `Route.use*()` calls. This renders
 * the view in a unit test without a router (PTR-75). The view keeps two router hooks for navigation
 * actions. Tests mock the module for those hooks.
 */
export function VenueDetailPage({
  venue,
  layouts,
  user,
  justCreated,
  requestContext,
  requestContextFailed,
  eventId,
  prefill = null,
}: {
  venue: VenueWithConflicts;
  /** The maintained list, from the route loader. The form and read-only view read it. */
  layouts: readonly RoomLayout[];
  user: SessionUser;
  justCreated: boolean;
  requestContext: VenueRequestContext | null;
  requestContextFailed: boolean;
  /** The event whose search led here. It offers the availability check and the event search. */
  eventId?: number;
  /**
   * The window and session values from the venue search or the rejection card. An absent value
   * takes the event's own.
   */
  prefill?: VenueRequestPrefill | null;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [saved, setSaved] = useState(justCreated);
  const [dirty, setDirty] = useState(false);
  // Guard a reload or tab close while edits are unsaved, as the new-venue page does.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const canUpdate = can(user.role, { venue: ["update"] });
  const canRequest = can(user.role, { venue_request: ["request"] });
  const activeConflicts = venue.bufferConflicts ?? [];

  // Seed the confirmation from `?saved=true` once, then strip the param. A search param belongs to
  // the URL, so F5 would re-evaluate it and re-announce a save that never happened. Use `replace`,
  // not a push. Back then still leaves this page. It does not return with the param restored.
  useEffect(() => {
    if (justCreated) {
      void navigate({
        to: "/venues/$venueId",
        params: { venueId: String(venue.id) },
        search: {},
        replace: true,
      });
    }
  }, [justCreated, navigate, venue.id]);

  const searchedRequirements: { term: string; value: string }[] = [];
  if (prefill?.date !== undefined) {
    searchedRequirements.push({
      term: "Date",
      value:
        prefill.startTime !== undefined && prefill.endTime !== undefined
          ? `${prefill.date}, ${prefill.startTime}–${prefill.endTime}`
          : prefill.date,
    });
  }
  if (prefill?.expectedAttendance !== undefined) {
    searchedRequirements.push({
      term: "Expected attendance",
      value: String(prefill.expectedAttendance),
    });
  }
  if (prefill?.layout) {
    searchedRequirements.push({ term: "Layout", value: prefill.layout });
  }
  if (prefill?.accessibilityRequirements) {
    searchedRequirements.push({ term: "Accessibility", value: prefill.accessibilityRequirements });
  }
  if (prefill?.requiredFacilities) {
    searchedRequirements.push({ term: "Facilities", value: prefill.requiredFacilities });
  }

  return (
    <Page width="page">
      <PageHeader
        back={
          <Link
            to="/venues"
            search={venueSearchFromPrefill(eventId, prefill)}
            className={NAV_LINK_CLASSNAME}
          >
            Back to venues
          </Link>
        }
        title={venue.name}
        description={
          canUpdate
            ? "Edit the record; Coordinators plan against whatever is saved here."
            : "Recorded by Venue Staff. Ask them if something here is out of date."
        }
        actions={
          <>
            {eventId !== undefined && (
              <Link
                to="/venues"
                search={{ eventId }}
                className={buttonVariants({ variant: "secondary" })}
              >
                More venues for this event
              </Link>
            )}
            <Link
              to="/venues/availability"
              search={{
                venueId: venue.id,
                ...(prefill?.date === undefined
                  ? {}
                  : { startDate: prefill.date, endDate: prefill.date }),
              }}
              className={buttonVariants()}
            >
              Check availability
            </Link>
          </>
        }
      />

      {saved && (
        <output className="mb-6 block body-sm font-medium text-foreground">
          Venue saved.
          {activeConflicts.length > 0 &&
            ` ${activeConflicts.length} ${activeConflicts.length === 1 ? "commitment now conflicts" : "commitments now conflict"}.`}
        </output>
      )}

      {canUpdate && activeConflicts.length > 0 && (
        <section
          aria-label="Flagged buffer conflicts"
          className="mb-6 rounded-lg border border-destructive/50 bg-destructive-tint p-4"
        >
          <h2 className="display-h3 text-destructive">Flagged buffer conflicts</h2>
          <p className="mt-1 body-sm text-muted-foreground">
            A buffer change created scheduling conflicts with the following commitments. The
            Coordinator decides what to do; Venue Staff release or amend a flagged booking (the
            Coordinator releases one that a block suspended), and the Coordinator releases a flagged
            hold.
          </p>
          <ul className="mt-3 divide-y divide-border/60">
            {activeConflicts.map(conflict => (
              <li
                key={`${conflict.kind}:${conflict.id}:${conflict.startsAt}`}
                className="py-2 body-sm"
              >
                <span className="font-medium text-foreground">
                  {conflict.kind === "booking"
                    ? "Approved booking"
                    : conflict.kind === "hold"
                      ? "Active hold"
                      : "Block-suspended piece"}
                </span>
                : <span className="font-medium">{conflict.eventName}</span> (
                <Link
                  to="/venues/availability"
                  search={{
                    venueId: venue.id,
                    startDate: conflict.startsAt.slice(0, 10),
                    endDate: conflict.endsAt.slice(0, 10),
                  }}
                  className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
                >
                  {formatPeriod(conflict.startsAt, conflict.endsAt)}
                </Link>
                )
              </li>
            ))}
          </ul>
        </section>
      )}

      {canUpdate ? (
        <VenueForm
          // Remount to reset the inputs to stored values (trimmed and de-duplicated), not typed values.
          // Key the form by the row identity. `updatedAt` changes on each save. `venue.id` guards
          // venue-to-venue navigation only. The route sets no `remountDeps` for that case, and nothing
          // links to it today. `initial` stays loader-derived in all cases.
          key={`${venue.id}-${venue.updatedAt.toString()}`}
          initial={venue}
          layouts={layouts}
          onDirtyChange={setDirty}
          onSave={async values => {
            // Drop and re-raise the banner around the save. Do not just set it. `<output>` is an implicit
            // live region. Re-announcing a repeat save needs the node to leave and return. Holding the same
            // words is not enough.
            setSaved(false);
            await saveVenue({ data: { ...values, id: venue.id } });
            // The loader is the only source for the row. Invalidating re-runs it. The re-run replaces
            // `venue` with saved values and bumps `updatedAt` (the column is `$onUpdate`). The key above
            // then changes, and the banner arrives with the reloaded values. Do not keep a local copy of
            // the response. Component state and loader data would drift apart.
            await router.invalidate({ filter: skipRootFilter });
            setSaved(true);
          }}
        />
      ) : (
        <VenueDetails venue={venue} layouts={layouts} />
      )}

      {searchedRequirements.length > 0 && (
        <section aria-label="Your search" className="mt-8">
          <h2 className="display-h3">Your search</h2>
          <p className="body-sm mt-2 text-muted-foreground">
            The requirements from the search that led here.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {searchedRequirements.map(requirement => (
              <div key={requirement.term}>
                <dt className="eyebrow text-muted-foreground">{requirement.term}</dt>
                <dd className="body-sm mt-1 font-medium">{requirement.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {requestContext ? (
        <VenueRequestPanel
          // Another event, venue or set of carried values starts a new form, so typed values do
          // not carry across.
          key={`${requestContext.event.id}:${venue.id}:${JSON.stringify(prefill)}`}
          venueId={venue.id}
          venueName={venue.name}
          context={requestContext}
          layouts={layouts}
          prefill={prefill}
        />
      ) : (
        canRequest &&
        (requestContextFailed ? (
          // Report a transient failure, not "no event". The loader could not load the panel. The
          // Coordinator can retry the same read. Do not send them back to the search.
          <div role="alert" className="mt-8 body-sm text-destructive">
            Could not load this venue's request panel.{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void router.invalidate({ filter: skipRootFilter })}
            >
              Try again
            </Button>
          </div>
        ) : null)
      )}
    </Page>
  );
}
