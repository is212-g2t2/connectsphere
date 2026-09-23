import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { CoordinationPage } from "#/features/coordination/components/coordination-page";
import { CoordinationPageSkeleton } from "#/features/coordination/components/coordination-page-skeleton";
import { listAssignedEventRequests } from "#/features/coordination/server-fns";
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
    const [unassigned, assigned] = await Promise.all([
      listUnassignedEventRequests(),
      listAssignedEventRequests(),
    ]);
    return { unassigned, assigned };
  },
  component: () => <CoordinationPage {...Route.useLoaderData()} />,
  pendingComponent: CoordinationPageSkeleton,
});
