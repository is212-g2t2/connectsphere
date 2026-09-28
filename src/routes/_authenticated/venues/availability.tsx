import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { listEvents } from "#/features/events/server-fns";
import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import { VenueCalendarPageSkeleton } from "#/features/venues/components/venue-calendar-page-skeleton";
import { parseAvailabilitySearch, parseAvailabilitySelection } from "#/features/venues/schema";
import { getVenueAvailability, listVenues } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/availability")({
  head: () => createSeoHead({ title: "Venue calendar — ConnectSphere", noindex: true }),
  validateSearch: parseAvailabilitySearch,
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // The chosen venue and range are the loader's input, so the loader re-runs when they change.
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const venues = await listVenues();
    const coordinatorEvents = can(context.user.role, { venue_request: ["request"] })
      ? await listEvents({ data: {} })
          .then(list =>
            list
              .filter(item => item.event.status === "submitted")
              .map(item => ({
                id: item.event.id,
                name: item.event.name ?? `Event ${item.event.id}`,
              }))
          )
          .catch(() => [])
      : [];
    const selection = parseAvailabilitySelection(deps);
    if (!selection) return { venues, schedule: null, coordinatorEvents };
    const { availability } = await getVenueAvailability({ data: selection });
    // A venue id that no row holds answers `null`, the same read convention `$venueId.tsx` uses: the router's own not-found boundary, not the error boundary a 404 response would raise.
    if (!availability) throw notFound();
    return { venues, schedule: availability, coordinatorEvents };
  },
  component: () => {
    const { venues, schedule, coordinatorEvents } = Route.useLoaderData();
    const search = Route.useSearch();
    const { user } = Route.useRouteContext();
    return (
      <VenueCalendarPage
        // Remounted when the applied range changes, so the form the loader answered reflects it.
        key={`${search.venueId ?? ""}:${search.startDate ?? ""}:${search.endDate ?? ""}`}
        venues={venues}
        schedule={schedule}
        search={search}
        user={user}
        coordinatorEvents={coordinatorEvents}
      />
    );
  },
  pendingComponent: VenueCalendarPageSkeleton,
});
