import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { formatLocalDate } from "#/features/event-requests/format";
import type { EventProjection } from "#/features/events/access";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-39 AC1: Technical Support's work list. `events` is what `listEvents` returned for the
 * signed-in member, so it already holds only the events whose equipment was submitted to them;
 * this view renders it and links each to its detail.
 */
export function EquipmentWorkListPage({ events }: { events: readonly EventProjection[] }) {
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>
      <PageHeader
        eyebrow="Technical Support"
        title="Equipment requests"
        description="Events whose equipment requirements have been submitted to Technical Support. Open one to review its lines and record how each is being arranged."
      />

      {events.length === 0 ? (
        <p className="body-sm text-muted-foreground">
          No equipment requests have been submitted to Technical Support.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Equipment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map(({ event }) => {
              const name = event.name ?? "Untitled event";
              const lineCount = event.equipment?.length ?? 0;
              return (
                <TableRow key={event.id}>
                  <TableCell>
                    <Link
                      to="/equipment-requests/$eventId"
                      params={{ eventId: String(event.id) }}
                      aria-label={`Open equipment request for ${name}`}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell>{event.eventDate ? formatLocalDate(event.eventDate) : "—"}</TableCell>
                  <TableCell>
                    {event.startTime && event.endTime ? `${event.startTime}–${event.endTime}` : "—"}
                  </TableCell>
                  <TableCell>{lineCount === 1 ? "1 line" : `${lineCount} lines`}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
