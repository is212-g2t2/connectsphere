import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { EventPage } from "#/features/events/components/event-page";
import type { EventProjection } from "#/features/events/access";
import { isPublishedForAttendees } from "#/features/events/access";
import { EventId } from "#/features/events/schema";
import { listEvents } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/events/$eventId")({
  head: () => createSeoHead({ title: "Event — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (context.user.role !== "attendee") {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }): Promise<EventProjection> => {
    // A junk path segment is a 404 without a round trip, as `$venueId.tsx` does.
    const parsed = EventId.safeParse(Number(params.eventId));
    if (!parsed.success) {
      throw notFound();
    }
    // A refusal crosses the server-function boundary as a plain `Error` with message
    // "Forbidden" (classes do not survive), so it becomes the same 404 as a missing event —
    // a hidden, foreign, or nonexistent event reveals nothing.
    let events: EventProjection[];
    try {
      events = await listEvents({ data: { eventId: parsed.data } });
    } catch (error) {
      if (error instanceof Error && error.message === "Forbidden") {
        throw notFound();
      }
      throw error;
    }
    const projection = events.at(0);
    // The page is only for published events (confirmed with registration on). A registered
    // attendee's non-confirmed event stays in the dashboard list but has no page (PTR-8 AC4
    // vs PTR-44 AC5).
    if (!projection || !isPublishedForAttendees(projection.event)) {
      throw notFound();
    }
    return projection;
  },
  component: () => <EventPage event={Route.useLoaderData()} />,
});
