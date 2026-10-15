import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { listEvents } from "#/features/events/server-fns";
import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import { VenueCalendarPageSkeleton } from "#/features/venues/components/venue-calendar-page-skeleton";
import {
  SEARCHABLE_EVENT_STATUSES,
  parseAvailabilitySearch,
  parseAvailabilitySelection,
} from "#/features/venues/schema";
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
  // Fetch the independent reads together. The availability read needs only the parsed
  // selection, so it joins the same round instead of waiting for the catalogue reads.
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    const selection = parseAvailabilitySelection(deps);
    const [venues, coordinatorEvents, schedule] = await Promise.all([
      listVenues(),
      can(context.user.role, { venue_request: ["request"] })
        ? listEvents({ data: {} })
            .then(list =>
              list
                .filter(item => SEARCHABLE_EVENT_STATUSES.includes(item.event.status))
                .map(item => ({
                  id: item.event.id,
                  name: item.event.name ?? `Event ${item.event.id}`,
                }))
            )
            .catch(() => [])
        : [],
      selection
        ? getVenueAvailability({ data: selection }).then(({ availability }) => availability)
        : null,
    ]);
    if (!selection) return { venues, schedule: null, coordinatorEvents };
    // If no row has this venue id, the read returns `null`, as `$venueId.tsx` does.
    // This uses the router's not-found boundary, not the error boundary for a 404 response.
    if (!schedule) throw notFound();
    return { venues, schedule, coordinatorEvents };
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
