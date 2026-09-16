import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { EventRequestsPage } from "#/features/event-requests/components/request-page";
import { getEventRequestDraft } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/event-requests/reopenDraft/$id")({
  head: () =>
    createSeoHead({
      title: "Edit event request — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }) => {
    const id = Number(params.id);

    if (!Number.isInteger(id) || id <= 0) {
      throw notFound();
    }

    try {
      return await unwrapRefusal(
        await getEventRequestDraft({ data: { id } }),
        "Could not load this draft. Try again."
      );
    } catch {
      throw notFound();
    }
  },
  component: () => <EventRequestsPage existingDraft={Route.useLoaderData()} />,
});
