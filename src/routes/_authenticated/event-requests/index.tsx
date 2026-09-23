import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EventRequestListPage } from "#/features/event-requests/components/request-list-page";
import { listEventRequests } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/event-requests/")({
  head: () => createSeoHead({ title: "Event requests — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listEventRequests(),
  component: () => <EventRequestListPage requests={Route.useLoaderData()} />,
});
