import { Link, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** Recording a venue. The route holds the `venue:create` guard; this holds the form around it. */
export function NewVenuePage() {
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
        submitLabel="Create venue"
        onSave={async values => {
          const venue = await saveVenue({ data: values });
          // `?saved=true` is only the hand-off; the detail route strips it on arrival so a
          // reload cannot resurrect the confirmation.
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
