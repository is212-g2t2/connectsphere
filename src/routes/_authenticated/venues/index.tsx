import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { listVenues } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/")({
  head: () => createSeoHead({ title: "Venues — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async () => {
    const venues = await listVenues();
    if (venues instanceof Response) {
      throw new Error((await venues.text()) || "Could not load venues. Try again.");
    }
    return venues;
  },
  component: () => (
    <VenueListPage user={Route.useRouteContext().user} venues={Route.useLoaderData()} />
  ),
});
