import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import { EventRequestIdInput } from "#/features/event-requests/schema";
import { getEventRequest } from "#/features/event-requests/server-fns";
import type { EventRequestDetail } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/event-requests/$requestId")({
  head: () => createSeoHead({ title: "Event request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }): Promise<EventRequestDetail> => {
    // The same rule the server function applies, so a junk path segment is a 404 without a
    // round trip, as `$venueId.tsx` does.
    const parsed = EventRequestIdInput.safeParse({ id: Number(params.requestId) });
    if (!parsed.success) {
      throw notFound();
    }
    const { request } = await unwrapRefusal(
      await getEventRequest({ data: parsed.data }),
      "Could not load this request. Try again."
    );
    // A row that is another organiser's comes back `null` too, so both cases are this 404.
    if (!request) {
      throw notFound();
    }
    return request;
  },
  component: () => <EventRequestDetailPage request={Route.useLoaderData()} />,
});
