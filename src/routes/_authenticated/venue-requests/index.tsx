import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { BookingRequestQueuePage } from "#/features/venue-requests/components/booking-request-queue-page";
import { BookingRequestQueueSkeleton } from "#/features/venue-requests/components/booking-request-queue-skeleton";
import { listPendingVenueRequests } from "#/features/venue-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venue-requests/")({
  head: () => createSeoHead({ title: "Pending booking requests — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue_request: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listPendingVenueRequests(),
  component: () => (
    <BookingRequestQueuePage requests={Route.useLoaderData()} user={Route.useRouteContext().user} />
  ),
  pendingComponent: BookingRequestQueueSkeleton,
});
