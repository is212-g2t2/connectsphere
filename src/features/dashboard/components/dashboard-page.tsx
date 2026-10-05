import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";
import type { EventProjection } from "#/features/events/access";
import { EventWorkspace } from "#/features/events/components/event-workspace";

/**
 * The signed-in home view. The session user and the connected events arrive as props rather than
 * through `Route.useRouteContext()` so the page renders in a unit test without a router (PTR-75),
 * and the events come from the dashboard loader, which calls the `listEvents` server function.
 */
export function DashboardPage({ user, events }: { user: SessionUser; events: EventProjection[] }) {
  return (
    <Page width="wide">
      <PageHeader eyebrow="Dashboard" title={`Welcome, ${user.name?.trim() || user.email}`} />

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
        {can(user.role, { event_request: ["create"] }) && (
          <Link to="/event-requests" className={NAV_LINK_CLASSNAME}>
            Event requests
          </Link>
        )}

        {can(user.role, { event_request: ["coordinate"] }) && (
          <Link to="/coordination" className={NAV_LINK_CLASSNAME}>
            Coordination
          </Link>
        )}

        {can(user.role, { venue: ["read"] }) && (
          <Link to="/venues" className={NAV_LINK_CLASSNAME}>
            Venues
          </Link>
        )}

        {can(user.role, { venue: ["read"] }) && (
          <Link to="/venues/availability" className={NAV_LINK_CLASSNAME}>
            Venue calendar
          </Link>
        )}

        {can(user.role, { venue_request: ["read"] }) && (
          <Link to="/venue-requests" className={NAV_LINK_CLASSNAME}>
            Booking requests
          </Link>
        )}

        {can(user.role, { venue_request: ["decide"] }) && (
          <Link to="/venue-bookings" className={NAV_LINK_CLASSNAME}>
            Approved bookings
          </Link>
        )}

        {can(user.role, { equipment_request: ["read"] }) && (
          <Link to="/equipment-requests" className={NAV_LINK_CLASSNAME}>
            Equipment requests
          </Link>
        )}
      </div>

      <EventWorkspace events={events} />
    </Page>
  );
}
