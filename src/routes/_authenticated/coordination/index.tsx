import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { CoordinationPage } from "#/features/coordination/components/coordination-page";
import { CoordinationPageSkeleton } from "#/features/coordination/components/coordination-page-skeleton";
import {
  listAssignedEventRequests,
  listPendingEventHandovers,
} from "#/features/coordination/server-fns";
import { listUnassignedEventRequests } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/coordination/")({
  head: () => createSeoHead({ title: "Coordination — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["coordinate"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async () => {
    const [unassigned, assigned, handovers] = await Promise.all([
      listUnassignedEventRequests(),
      listAssignedEventRequests(),
      listPendingEventHandovers(),
    ]);
    return { unassigned, assigned, handovers };
  },
  component: () => <CoordinationPage {...Route.useLoaderData()} />,
  pendingComponent: CoordinationPageSkeleton,
});
