import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EventId } from "#/features/events/schema";
import { AttendeesPage } from "#/features/events/components/attendees-page";
import { AttendeesPageSkeleton } from "#/features/events/components/attendees-page-skeleton";
import { listEventRegistrations, listEvents } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/events/$eventId/attendees")({
  head: () => createSeoHead({ title: "Attendees — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_registration: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }) => {
    // A junk path segment is a 404 without a round trip, as `equipment-requests/$eventId.tsx`
    // does. A refusal crosses the server-function boundary as a plain `Error` with a fixed
    // message (classes do not survive), so "Forbidden" and "Not Found" become the same 404 as a
    // missing event — a hidden, foreign, or nonexistent event reveals nothing.
    const parsed = EventId.safeParse(Number(params.eventId));
    if (!parsed.success) throw notFound();
    const [entries, attendees] = await Promise.all([
      listEvents({ data: { eventId: parsed.data } }).catch((error: unknown) => {
        if (
          error instanceof Error &&
          (error.message === "Forbidden" || error.message === "Not Found")
        ) {
          throw notFound();
        }
        throw error;
      }),
      listEventRegistrations({ data: { id: parsed.data } }).catch((error: unknown) => {
        if (
          error instanceof Error &&
          (error.message === "Forbidden" || error.message === "Not Found")
        ) {
          throw notFound();
        }
        throw error;
      }),
    ]);
    const entry = entries.at(0);
    if (!entry) throw notFound();
    return {
      eventName: entry.event.name ?? "Event",
      places: entry.event.places ?? null,
      attendees,
    };
  },
  component: () => <AttendeesPage {...Route.useLoaderData()} />,
  pendingComponent: AttendeesPageSkeleton,
});
