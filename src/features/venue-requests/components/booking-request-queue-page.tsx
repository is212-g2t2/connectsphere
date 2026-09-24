import { Link, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import type { PendingBookingRequest } from "#/features/venue-requests/server-fns";
import { BookingRequestQueue } from "#/features/venue-requests/components/booking-request-queue";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function BookingRequestQueuePage({
  requests,
}: {
  requests: readonly PendingBookingRequest[];
}) {
  const navigate = useNavigate();

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>
      <PageHeader
        eyebrow="Venue operations"
        title="Pending booking requests"
        description="Review every pending request in submission order. Conflict flags identify periods that overlap an approved booking before you open the request."
      />
      <BookingRequestQueue
        pendingRequestsOldestFirst={requests}
        onOpenRequest={id => {
          void navigate({ to: "/venue-requests/$requestId", params: { requestId: id } });
        }}
      />
    </Page>
  );
}
