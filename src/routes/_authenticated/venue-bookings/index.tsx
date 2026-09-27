import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { VenueBookingsPage } from "#/features/venue-requests/components/venue-bookings-page";
import { VenueBookingsSkeleton } from "#/features/venue-requests/components/venue-bookings-skeleton";
import { listVenueBookings } from "#/features/venue-requests/server-fns";
import { listVenueOptions } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venue-bookings/")({
  head: () => createSeoHead({ title: "Approved bookings — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue_request: ["decide"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async () => {
    const [bookings, venues] = await Promise.all([listVenueBookings(), listVenueOptions()]);
    return { bookings, venues };
  },
  component: () => {
    const { user } = Route.useRouteContext();
    const { bookings, venues } = Route.useLoaderData();
    return <VenueBookingsPage bookings={bookings} venues={venues} currentStaffId={user.id} />;
  },
  pendingComponent: VenueBookingsSkeleton,
});
