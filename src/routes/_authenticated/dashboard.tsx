import { createFileRoute } from "@tanstack/react-router";

import { unwrapRefusal } from "#/features/auth/session";
import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { DashboardPageSkeleton } from "#/features/dashboard/components/dashboard-page-skeleton";
import { listEvents } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => createSeoHead({ title: "Dashboard — ConnectSphere", noindex: true }),
  loader: async () =>
    unwrapRefusal(await listEvents({ data: {} }), "Could not load events. Try again."),
  component: () => (
    <DashboardPage user={Route.useRouteContext().user} events={Route.useLoaderData()} />
  ),
  pendingComponent: DashboardPageSkeleton,
});
