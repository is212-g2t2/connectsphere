import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { buttonVariants } from "#/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#/components/ui/empty";
import type { DashboardData, DashboardAction } from "#/features/dashboard/dashboard-view";
import { dashboardView } from "#/features/dashboard/dashboard-view";
import { EventRow, isActionableRow } from "#/features/events/components/event-row";

/**
 * The signed-in home view: the role-aware copy and counts from `dashboardView`, one event row
 * per connected event with actionable rows first, and a role-aware empty state with an action.
 * The data arrives as props rather than through `Route.useRouteContext()` so the page renders
 * in a unit test without a router (PTR-75), and the events come from the dashboard loader, which
 * calls the `listEvents` server function plus the role's queue reads.
 */
export function DashboardPage({ data }: { data: DashboardData }) {
  const view = dashboardView(data);
  const safetyReviewEventIds = (data.safetyReviews ?? []).map(review => review.eventId);
  const actionable = data.events.filter(row => isActionableRow(row, safetyReviewEventIds));
  const settled = data.events.filter(row => !isActionableRow(row, safetyReviewEventIds));
  const emptyAction: DashboardAction | undefined =
    view.primaryAction ??
    view.groups.map(group => ({ label: group.title, href: group.href })).at(0);
  return (
    <Page width="wide">
      <PageHeader
        title={view.title}
        description={view.description}
        actions={
          view.primaryAction ? (
            <Link to={view.primaryAction.href} className={buttonVariants()}>
              {view.primaryAction.label}
            </Link>
          ) : undefined
        }
      />

      {data.events.length === 0 && view.empty ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{view.empty.title}</EmptyTitle>
            <EmptyDescription>{view.empty.description}</EmptyDescription>
          </EmptyHeader>
          {emptyAction ? (
            <EmptyContent>
              <Link to={emptyAction.href} className={buttonVariants()}>
                {emptyAction.label}
              </Link>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <>
          {view.groups.length > 0 ? (
            <ul className="mb-6 flex flex-wrap gap-2" aria-label="Queues">
              {view.groups.map(group => (
                <li key={group.title}>
                  <Link
                    to={group.href}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {group.title} ({group.count})
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mb-4 body-sm text-muted-foreground">
            {data.events.length === 1 ? "1 event" : `${data.events.length} events`}
            {actionable.length > 0
              ? ` · ${actionable.length} need${actionable.length === 1 ? "s" : ""} attention`
              : ""}
          </p>
          <ul className="divide-y divide-border" aria-label="Events">
            {[...actionable, ...settled].map(projection => (
              <li key={projection.event.id} className="py-4 first:pt-0 last:pb-0">
                <EventRow projection={projection} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}
