import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import type { PendingBookingRequestDetail } from "#/features/venue-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function BookingRequestDetailsPage({ request }: { request: PendingBookingRequestDetail }) {
  return (
    <Page width="page">
      <Link to="/venue-requests" className={NAV_LINK_CLASSNAME}>
        Back to pending requests
      </Link>
      <PageHeader
        eyebrow="Venue operations"
        title="Review booking request"
        description="Read-only request details. Approval and withdrawal remain on their respective workflows."
      />
      <BookingRequestDetails request={request} />
    </Page>
  );
}
