import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { BookingRequestDetailsPage } from "#/features/venue-requests/components/booking-request-details-page";
import { BookingRequestDetailsSkeleton } from "#/features/venue-requests/components/booking-request-details-skeleton";
import { VenueRequestIdInput } from "#/features/venue-requests/schema";
import { getPendingVenueRequest } from "#/features/venue-requests/server-fns";
import { listVenues } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venue-requests/$requestId")({
  head: () => createSeoHead({ title: "Review booking request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue_request: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params, context }) => {
    const parsed = VenueRequestIdInput.safeParse({ id: params.requestId });
    if (!parsed.success) throw notFound();
    const [request, venues] = await Promise.all([
      getPendingVenueRequest({ data: parsed.data }),
      // Only a role that may reject offers a suggested venue, and it picks from the catalogue.
      can(context.user.role, { venue_request: ["decide"] }) ? listVenues() : [],
    ]);
    // A missing row, or one that already left `pending`, comes back `null`: both are this 404.
    if (!request) throw notFound();
    return { request, venues: venues.map(({ id, name }) => ({ id, name })) };
  },
  component: () => {
    const { request, venues } = Route.useLoaderData();
    return (
      <BookingRequestDetailsPage
        request={request}
        venues={venues}
        user={Route.useRouteContext().user}
      />
    );
  },
  pendingComponent: BookingRequestDetailsSkeleton,
});
