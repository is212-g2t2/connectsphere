import { Page, PageHeader } from "#/components/layout/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import type { EventProjection } from "#/features/events/access";
import { EventCard } from "#/features/events/components/event-card";

/**
 * The signed-in home view: one card per connected event. The events arrive as props rather than
 * through `Route.useRouteContext()` so the page renders in a unit test without a router (PTR-75),
 * and the events come from the dashboard loader, which calls the `listEvents` server function.
 */
export function DashboardPage({ events }: { events: EventProjection[] }) {
  return (
    <Page width="wide">
      <PageHeader eyebrow="Dashboard" title="Your events" />

      {events.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No events yet</EmptyTitle>
            <EmptyDescription>No events are currently connected to your account.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {events.map(projection => (
            <EventCard key={projection.event.id} event={projection} />
          ))}
        </div>
      )}
    </Page>
  );
}
