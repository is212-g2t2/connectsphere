import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
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
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome, ${user.name?.trim() || user.email}`}
        description="Your ConnectSphere home. Events and requests are filtered by your role and relationship to each event; server-side checks enforce the same boundary for direct requests."
      />

      <Card>
        <CardContent>
          <dl className="grid gap-6 sm:grid-cols-3">
            <div>
              <dt className="eyebrow text-muted-foreground">Session</dt>
              <dd className="mt-2 body-md font-medium">Active</dd>
            </div>
            <div>
              <dt className="eyebrow text-muted-foreground">Email</dt>
              <dd className="mt-2 truncate body-md font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="eyebrow text-muted-foreground">Role</dt>
              <dd className="mt-2 truncate body-md font-medium">{user.role ?? "attendee"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
        <Link to="/notifications" className={NAV_LINK_CLASSNAME}>
          Notifications
        </Link>

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

      <div className="mt-12 border-t border-border pt-6">
        <Link to="/settings" className={NAV_LINK_CLASSNAME}>
          Account settings
        </Link>
      </div>
    </Page>
  );
}
