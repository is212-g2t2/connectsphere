import { Link, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import type { RoomLayout } from "#/features/venues/schema";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** Record a venue. The route owns the `venue:create` guard. This page owns the form. */
export function NewVenuePage({ layouts }: { layouts: readonly RoomLayout[] }) {
  const navigate = useNavigate();

  return (
    <Page width="page">
      <Link to="/venues" className={NAV_LINK_CLASSNAME}>
        Back to venues
      </Link>

      <PageHeader
        title="New venue"
        description="Record the space as Coordinators will plan against it."
      />

      <VenueForm
        layouts={layouts}
        submitLabel="Create venue"
        onSave={async values => {
          const venue = await saveVenue({ data: values });
          // Treat `?saved=true` only as a hand-off. The detail route strips it on arrival. A reload
          // then cannot resurrect the confirmation.
          await navigate({
            to: "/venues/$venueId",
            params: { venueId: String(venue.id) },
            search: { saved: "true" },
          });
        }}
      />
    </Page>
  );
}
