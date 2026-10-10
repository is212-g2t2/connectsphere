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
    // A junk path segment is a 404 without a round trip, as `$venueId.tsx` does.
    const parsed = EventId.safeParse(Number(params.eventId));
    if (!parsed.success) {
      throw notFound();
    }
    // A refusal or a missing event comes back `null`, which becomes the same 404 — a hidden,
    // foreign, or nonexistent event reveals nothing.
    const data = await loadEventPageData(parsed.data, context.user.role, context.user.id);
    if (!data) {
      throw notFound();
    }
    return data;
  },
  component: () => <EventDetailPage data={Route.useLoaderData()} />,
  pendingComponent: EventDetailPageSkeleton,
});
