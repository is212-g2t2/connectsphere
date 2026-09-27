import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { ApproveBookingButton } from "#/features/venue-requests/components/approve-booking-button";
import { RejectBookingForm } from "#/features/venue-requests/components/reject-booking-form";
import { BookingRequestDetails } from "#/features/venue-requests/components/booking-request-details";
import type { PendingVenueRequestDetail } from "#/features/venue-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function BookingRequestDetailsPage({
  request,
  user,
  venues,
}: {
  request: PendingVenueRequestDetail;
  user: SessionUser;
  /** The catalogue Venue Staff may suggest from when they reject. */
  venues: readonly { id: number; name: string }[];
}) {
  const canDecide = can(user.role, { venue_request: ["decide"] });
  return (
    <Page width="page">
      <Link to="/venue-requests" className={NAV_LINK_CLASSNAME}>
        Back to pending requests
      </Link>
      <PageHeader
        eyebrow="Venue operations"
        title="Review booking request"
        description="Check the requested period and the event's requirements, then record a decision."
      />
      <BookingRequestDetails request={request} />
      {canDecide && (
        <section className="mt-8" aria-labelledby="booking-decision-heading">
          <h2 id="booking-decision-heading" className="display-h3">
            Record a decision
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            Approving holds the venue for this exact period. Rejecting needs a reason, and you can
            suggest an alternative. Either way the requesting Coordinator is notified.
          </p>
          <div className="mt-4">
            <ApproveBookingButton request={request} />
          </div>
          <div className="mt-6 border-t border-border pt-6">
            <h3 className="display-h3">Reject this request</h3>
            <div className="mt-4">
              <RejectBookingForm request={request} venues={venues} />
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}
