import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EventRequestsPage } from "#/features/event-requests/components/request-page";
import { EventRequestsPageSkeleton } from "#/features/event-requests/components/request-page-skeleton";
import { listRoomLayouts } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/event-requests/new")({
  head: () => createSeoHead({ title: "New event request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // The event form's room-layout preference offers the maintained list (PTR-161 AC1). A failed
  // read leaves the form on the initials, as `load-page-data.ts` does.
  loader: async () => ({ layouts: await listRoomLayouts().catch(() => undefined) }),
  component: () => <EventRequestsPage layouts={Route.useLoaderData().layouts} />,
  pendingComponent: EventRequestsPageSkeleton,
});
