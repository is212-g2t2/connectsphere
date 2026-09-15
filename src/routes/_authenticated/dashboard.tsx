import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { unwrapRefusal } from "#/features/auth/session";
import { listAssignmentNotifications } from "#/features/coordination/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => createSeoHead({ title: "Dashboard — ConnectSphere", noindex: true }),
  loader: () =>
    unwrapRefusal(listAssignmentNotifications(), "Could not load assignment notifications."),
  component: () => (
    <DashboardPage user={Route.useRouteContext().user} notifications={Route.useLoaderData()} />
  ),
});
