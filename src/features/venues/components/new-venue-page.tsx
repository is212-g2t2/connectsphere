import { Link, useNavigate } from "@tanstack/react-router";

import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** Recording a venue. The route holds the `venue:create` guard; this holds the form around it. */
export function NewVenuePage() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/venues" className={NAV_LINK_CLASSNAME}>
        Back to venues
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">New venue</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Record the space as Coordinators will plan against it.
      </p>

      <div className="mt-10">
        <VenueForm
          submitLabel="Create venue"
          onSave={async values => {
            const venue = await saveVenue({ data: values });
            if (venue instanceof Response) {
              throw new Error((await venue.text()) || "Could not save this venue. Try again.");
            }
            // `?saved=true` is only the hand-off; the detail route strips it on arrival so a
            // reload cannot resurrect the confirmation.
            await navigate({
              to: "/venues/$venueId",
              params: { venueId: String(venue.id) },
              search: { saved: "true" },
            });
          }}
        />
      </div>
    </main>
  );
}
