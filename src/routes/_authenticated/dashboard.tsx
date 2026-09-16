import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => createSeoHead({ title: "Dashboard — ConnectSphere", noindex: true }),
  component: () => <DashboardPage user={Route.useRouteContext().user} />,
});
