import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { BookingRequestDetailsPage } from "#/features/venue-requests/components/booking-request-details-page";
import { VenueRequestIdInput } from "#/features/venue-requests/schema";
import { getPendingVenueRequest } from "#/features/venue-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venue-requests/$requestId")({
  head: () => createSeoHead({ title: "Review booking request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue_request: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }) => {
    const parsed = VenueRequestIdInput.safeParse({ id: params.requestId });
    if (!parsed.success) throw notFound();
    return getPendingVenueRequest({ data: parsed.data });
  },
  component: () => <BookingRequestDetailsPage request={Route.useLoaderData()} />,
});
