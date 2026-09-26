import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { ApproveBookingButton } from "#/features/venue-requests/components/approve-booking-button";
import type { PendingVenueRequest } from "#/features/venue-requests/server-fns";
import { BookingRequestQueue } from "#/features/venue-requests/components/booking-request-queue";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function BookingRequestQueuePage({
  requests,
  user,
}: {
  requests: readonly PendingVenueRequest[];
  user: SessionUser;
}) {
  // Reading the queue and deciding on it are separate permissions; hiding the control is
  // presentation, and the server function still enforces `venue_request:decide`.
  const canDecide = can(user.role, { venue_request: ["decide"] });
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>
      <PageHeader
        eyebrow="Venue operations"
        title="Pending booking requests"
        description="Review every pending request, oldest first. Conflict flags identify periods that overlap an approved booking before you open the request."
      />
      <BookingRequestQueue
        requests={requests}
        RowAction={canDecide ? ApproveBookingButton : undefined}
      />
    </Page>
  );
}
