import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Page, PageHeader } from "#/components/layout/page";
import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { VenueDetails } from "#/features/venues/components/venue-details";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import type { Venue } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * One venue record — editable for `venue:update`, read-only for everyone else the route let in.
 *
 * The row, the session user and the just-created flag are props rather than `Route.use*()` calls
 * so the view renders in a unit test without a router (PTR-75); the two router hooks it does keep
 * are the ones that act on navigation, which a test mocks the module for.
 */
export function VenueDetailPage({
  venue,
  user,
  justCreated,
}: {
  venue: Venue;
  user: SessionUser;
  justCreated: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [saved, setSaved] = useState(justCreated);
  const canUpdate = can(user.role, { venue: ["update"] });

  // The confirmation is seeded from `?saved=true` once, above, and then the param is stripped:
  // a search param is part of the URL, so F5 would re-evaluate it and re-announce a save that
  // never happened. `replace` rather than a push so Back still leads out of this page rather
  // than to the same page with the param restored.
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
        <output className="mb-6 block body-sm font-medium text-foreground">Venue saved.</output>
      )}

      {canUpdate ? (
        <VenueForm
          // Remounting is what resets the inputs to the stored values (trimmed,
          // de-duplicated) rather than what was typed, so the key is the row's identity:
          // `updatedAt` is the part that changes on a save, and `venue.id` only guards a
          // venue-to-venue navigation, which the route sets no `remountDeps` for and which
          // nothing links to today. `initial` is loader-derived either way.
          key={`${venue.id}-${venue.updatedAt.toString()}`}
          initial={venue}
          onSave={async values => {
            // Dropped and re-raised around the save rather than just set: `<output>` is an
            // implicit live region, and re-announcing a repeat save needs the node to go
            // away and come back, not merely to hold the same words.
            setSaved(false);
            await unwrapRefusal(
              await saveVenue({ data: { ...values, id: venue.id } }),
              "Could not save this venue. Try again."
            );
            // The loader is the only source for the row. Invalidating re-runs it, which
            // replaces `venue` with the saved values and bumps `updatedAt` (the column is
            // `$onUpdate`), so the key above changes and the banner arrives together with
            // the reloaded values. Keeping a local copy of the response instead would let
            // component state and loader data drift apart.
            await router.invalidate();
            setSaved(true);
          }}
        />
      ) : (
        <VenueDetails venue={venue} />
      )}
    </Page>
  );
}
