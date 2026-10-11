import { createFileRoute, notFound } from "@tanstack/react-router";

import { EventDetailPage } from "#/features/events/components/event-detail-page";
import { EventDetailPageSkeleton } from "#/features/events/components/event-detail-page-skeleton";
import type { EventPageData } from "#/features/events/page-data";
import { EventId } from "#/features/events/schema";
import { loadEventPageData } from "#/features/events/load-page-data";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/events/$eventId/")({
  head: () => createSeoHead({ title: "Event — ConnectSphere", noindex: true }),
  loader: async ({ params, context }): Promise<EventPageData> => {
    // A malformed path segment returns 404 without a server call, as `$venueId.tsx` does.
    const parsed = EventId.safeParse(Number(params.eventId));
    if (!parsed.success) {
      throw notFound();
    }
    // A refusal or missing event returns `null`, then the route returns 404.
    // The response does not reveal whether the event is hidden, belongs to someone else, or does not exist.
    const data = await loadEventPageData(parsed.data, context.user.role, context.user.id);
    if (!data) {
      throw notFound();
    }
    return data;
  },
  component: () => <EventDetailPage data={Route.useLoaderData()} />,
  pendingComponent: EventDetailPageSkeleton,
});
