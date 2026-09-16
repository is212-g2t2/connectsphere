import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { EventRequestsPage } from "#/features/event-requests/components/request-page";
import { EventRequestIdInput } from "#/features/event-requests/schema";
import { getEventRequestDraft } from "#/features/event-requests/server-fns";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
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
  loader: async ({ params }): Promise<EventRequestDraft> => {
    // The same rule the server function applies, so a junk path segment is a 404 without a round trip, as `$requestId.tsx` does.
    const parsed = EventRequestIdInput.safeParse({ id: Number(params.id) });
    if (!parsed.success) {
      throw notFound();
    }
    const { draft } = await unwrapRefusal(
      await getEventRequestDraft({ data: parsed.data }),
      "Could not load this draft. Try again."
    );
    // Another organiser's row, a submitted request, and a missing id all come back `null`, so none of them is reopenable here and all three are this 404.
    if (!draft) {
      throw notFound();
    }
    return draft;
  },
  component: () => <EventRequestsPage existingDraft={Route.useLoaderData()} />,
});
