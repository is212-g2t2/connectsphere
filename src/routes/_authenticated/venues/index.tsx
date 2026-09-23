import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { VenueListPageSkeleton } from "#/features/venues/components/venue-list-page-skeleton";
import { parseVenueSearch } from "#/features/venues/schema";
import { listVenues, searchVenues } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/")({
  head: () => createSeoHead({ title: "Venues — ConnectSphere", noindex: true }),
  validateSearch: parseVenueSearch,
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    if (can(context.user.role, { venue: ["search"] })) {
      return searchVenues({ data: deps });
    }

    return {
      event: null,
      filters: {},
      venues: await listVenues(),
    };
  },
  component: () => (
    <VenueListPage user={Route.useRouteContext().user} result={Route.useLoaderData()} />
  ),
  pendingComponent: VenueListPageSkeleton,
});
