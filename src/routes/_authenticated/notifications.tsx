import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "#/features/notifications/components/notifications-page";
import { NotificationsPageSkeleton } from "#/features/notifications/components/notifications-page-skeleton";
import { listNotifications } from "#/features/notifications/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => createSeoHead({ title: "Notifications — ConnectSphere", noindex: true }),
  loader: () => listNotifications(),
  component: () => <NotificationsPage notifications={Route.useLoaderData()} />,
  pendingComponent: NotificationsPageSkeleton,
});
