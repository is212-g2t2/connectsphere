import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function BookingRequestDetailsPage({ request }: { request: PendingVenueRequestDetail }) {
  return (
    <Page width="page">
      <Link to="/venue-requests" className={NAV_LINK_CLASSNAME}>
        Back to pending requests
      </Link>
      <PageHeader
        eyebrow="Venue operations"
        title="Review booking request"
        description="Read-only request details. This view does not approve, reject, or withdraw the request."
      />
      <BookingRequestDetails request={request} />
    </Page>
  );
}
