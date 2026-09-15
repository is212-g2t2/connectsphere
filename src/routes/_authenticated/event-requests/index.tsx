import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
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
  loader: async () =>
    unwrapRefusal(await listEventRequests(), "Could not load your requests. Try again."),
  component: () => <EventRequestListPage requests={Route.useLoaderData()} />,
});
