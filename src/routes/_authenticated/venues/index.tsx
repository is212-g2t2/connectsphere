import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
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
  loader: async () => unwrapRefusal(await listVenues(), "Could not load venues. Try again."),
  component: () => (
    <VenueListPage user={Route.useRouteContext().user} venues={Route.useLoaderData()} />
  ),
});
