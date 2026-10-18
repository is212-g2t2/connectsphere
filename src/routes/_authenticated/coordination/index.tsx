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
    if (
      !can(context.user.role, { event_request: ["coordinate"] }) &&
      !can(context.user.role, { event_request: ["oversee"] })
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ context }) => {
    // PTR-144: the Lead reads the unassigned queue, the Coordinator their assignments and the
    // handovers waiting on them. Each view loads only the lists it shows.
    if (can(context.user.role, { event_request: ["oversee"] })) {
      return {
        view: "lead" as const,
        unassigned: await listUnassignedEventRequests(),
        assigned: [],
        handovers: [],
      };
    }
    const [assigned, handovers] = await Promise.all([
      listAssignedEventRequests(),
      listPendingEventHandovers(),
    ]);
    return { view: "coordinator" as const, unassigned: [], assigned, handovers };
  },
  component: () => <CoordinationPage {...Route.useLoaderData()} />,
  pendingComponent: CoordinationPageSkeleton,
});
