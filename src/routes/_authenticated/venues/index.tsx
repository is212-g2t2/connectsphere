import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
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
      return unwrapRefusal(
        await searchVenues({ data: deps }),
        "Venue search could not be loaded. Try again."
      );
    }

    return {
      event: null,
      filters: {},
      venues: await unwrapRefusal(listVenues(), "Venues could not be loaded. Try again."),
    };
  },
  component: () => {
    const result = Route.useLoaderData();
    return (
      <VenueListPage
        key={JSON.stringify(result.filters)}
        user={Route.useRouteContext().user}
        result={result}
      />
    );
  },
});
