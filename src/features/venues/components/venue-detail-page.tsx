import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { VenueRequestPanel } from "#/features/venue-requests/components/venue-request-panel";
import type { VenueRequestPrefill } from "#/features/venue-requests/schema";
import { formatPeriod } from "#/features/emails/format";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import type { RoomLayout } from "#/features/venues/schema";
import type { VenueWithConflicts } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * Show one venue record. Holders of `venue:update` can edit it. Other admitted roles see it
 * read-only. A Coordinator from an event search also sees PTR-31's request panel. The loader
 * supplies a context only for the caller's own event.
 *
 * Pass the row, session user, and just-created flag as props, not `Route.use*()` calls. This renders
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
  prefill = null,
}: {
  venue: VenueWithConflicts;
  /** The maintained list, from the route loader. The form and read-only view read it. */
  layouts: readonly RoomLayout[];
  user: SessionUser;
  justCreated: boolean;
  requestContext: VenueRequestContext | null;
  requestContextFailed: boolean;
  /**
   * The window and session values from the venue search or the rejection card. An absent value
   * takes the event's own.
   */
  prefill?: VenueRequestPrefill | null;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [saved, setSaved] = useState(justCreated);
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

  return (
    <Page width="page">
      <Link to="/venues" className={NAV_LINK_CLASSNAME}>
        Back to venues
      </Link>

      <PageHeader
        title={venue.name}
        description={
          canUpdate
            ? "Edit the record; Coordinators plan against whatever is saved here."
            : "Recorded by Venue Staff. Ask them if something here is out of date."
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
        ) : (
          <p className="mt-8 body-sm text-muted-foreground">
            Open your{" "}
            <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
              dashboard
            </Link>{" "}
            and use Find venues for this event.
          </p>
        ))
      )}
    </Page>
  );
}
