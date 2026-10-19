import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { VenueBookingsSkeleton } from "#/features/venue-requests/components/venue-bookings-skeleton";
import { VenueHoldRequestsPage } from "#/features/venue-requests/components/venue-hold-requests-page";
import { listVenueHoldRequests } from "#/features/venue-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venue-holds/")({
  head: () => createSeoHead({ title: "Hold requests — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue_request: ["decide"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listVenueHoldRequests(),
  component: () => <VenueHoldRequestsPage requests={Route.useLoaderData()} />,
  pendingComponent: () => <VenueBookingsSkeleton label="Loading hold requests…" />,
});
