import { createFileRoute } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { RoleSchema } from "#/features/auth/schema/role";
import { listAssignedEventRequests } from "#/features/coordination/server-fns";
import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { DashboardPageSkeleton } from "#/features/dashboard/components/dashboard-page-skeleton";
import type { DashboardData } from "#/features/dashboard/dashboard-view";
import {
  listEventRequests,
  listUnassignedEventRequests,
} from "#/features/event-requests/server-fns";
import { listEvents } from "#/features/events/server-fns";
import { listSafetyReviews } from "#/features/safety-reviews/server-fns";
import { listVenueBookings, listVenueHoldRequests } from "#/features/venue-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

/**
 * Load each queue only for the role that holds it. Each gate matches the server function's own
 * permission (`listVenueBookings` and `listVenueHoldRequests` take the `decide` verb, not the
 * shared queue `read`), so a refused read never fires and a real failure reaches the error
 * boundary instead of degrading to an empty dashboard.
 */
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => createSeoHead({ title: "Dashboard — ConnectSphere", noindex: true }),
  loader: async ({ context }): Promise<DashboardData> => {
    const parsed = RoleSchema.safeParse(context.user.role);
    const role = parsed.success ? parsed.data : "attendee";
    const [events, safetyReviews, bookings, holds, drafts, assignedRequests, unassignedRequests] =
      await Promise.all([
        listEvents({ data: {} }),
        can(role, { safety_review: ["read"] }) ? listSafetyReviews() : [],
        can(role, { venue_request: ["decide"] }) ? listVenueBookings() : [],
        can(role, { venue_request: ["decide"] }) ? listVenueHoldRequests() : [],
        can(role, { event_request: ["create"] }) ? listEventRequests() : [],
        can(role, { event_request: ["coordinate"] }) ? listAssignedEventRequests() : [],
        can(role, { event_request: ["oversee"] }) ? listUnassignedEventRequests() : [],
      ]);
    return {
      role,
      events,
      safetyReviews,
      bookings,
      holds,
      drafts,
      assignedRequests,
      unassignedRequests,
    };
  },
  component: () => <DashboardPage data={Route.useLoaderData()} />,
  pendingComponent: DashboardPageSkeleton,
});
