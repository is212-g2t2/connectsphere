import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { getCurrentUser } from "#/features/auth/session";
import { VenueForm } from "#/features/venues/components/venue-form";
import { saveVenue } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/venues/new")({
  head: () =>
    createSeoHead({
      title: "New venue — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    // Presentation only: `saveVenue` re-checks the permission on the server.
    if (!can(user.role, { venue: ["create"] })) {
      throw redirect({ to: "/venues" });
    }
  },
  component: NewVenuePage,
});

function NewVenuePage() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link
        to="/venues"
        className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
      >
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
