import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#/components/ui/empty";
import { Field, FieldLabel } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import { UNTITLED_REQUEST } from "#/features/event-requests/components/request-list-page";
import { formatInstant, formatVenueWindow } from "#/features/event-requests/format";
import type { PendingSafetyReview } from "#/features/safety-reviews/schema";
import { SAFETY_REVIEW_WITHDRAWN_LABEL } from "#/features/safety-reviews/schema";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-146 AC2: the Safety Officer's shared review list. Every pending review on an approved or
 * planning event shows. A pending review whose arrangements changed since it was raised shows as
 * withdrawn, and a review on a cancelled, completed or rejected event does not show at all. Rows
 * arrive from the route's loader; opening one reads the event and its decision form.
 */
export function SafetyReviewsPage({ reviews }: { reviews: PendingSafetyReview[] }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "current" | "withdrawn">("all");
  const filtered = reviews.filter(
    review =>
      statusFilter === "all" || (statusFilter === "current" ? review.current : !review.current)
  );

  return (
    <Page width="wide">
      <PageHeader
        title="Safety reviews"
        description="Events whose venue and technical arrangements are complete. Open an event to read its arrangements and record your decision."
      />

      {reviews.length > 0 ? (
        <p className="body-sm text-muted-foreground" aria-live="polite">
          {reviewCountCopy(filtered.length, reviews.length)}
        </p>
      ) : null}

      {reviews.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No events await a safety review.</EmptyTitle>
            <EmptyDescription>
              Reviews appear here when an event&apos;s venue and technical arrangements are
              complete.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/dashboard" className={buttonVariants({ size: "sm" })}>
              Back to dashboard
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Card>
            <CardContent>
              <Field className="max-w-xs">
                <FieldLabel htmlFor="safety-status-filter">Review status</FieldLabel>
                <Select
                  value={statusFilter}
                  onValueChange={value =>
                    setStatusFilter(value === "current" || value === "withdrawn" ? value : "all")
                  }
                >
                  <SelectTrigger id="safety-status-filter" className="w-full">
                    <SelectValue>
                      {(value: string | null) =>
                        value === "current"
                          ? "Awaiting decision"
                          : value === "withdrawn"
                            ? "Withdrawn"
                            : "All reviews"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All reviews</SelectItem>
                    <SelectItem value="current">Awaiting decision</SelectItem>
                    <SelectItem value="withdrawn">Withdrawn</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          {filtered.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No reviews match this filter.</EmptyTitle>
                <EmptyDescription>Show every review, or pick another status.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="mt-10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Venue</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Raised</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(review => (
                    <TableRow key={review.id}>
                      <TableCell>
                        <Link
                          to="/events/$eventId"
                          params={{ eventId: String(review.eventId) }}
                          className={NAV_LINK_CLASSNAME}
                        >
                          {review.eventName.trim() || UNTITLED_REQUEST}
                        </Link>
                        <div className="mt-1">
                          <EventRequestStatusBadge status={review.eventStatus} />
                        </div>
                      </TableCell>
                      <TableCell>{review.venue?.name ?? "No approved venue"}</TableCell>
                      <TableCell>{review.venue ? formatVenueWindow(review.venue) : "—"}</TableCell>
                      <TableCell>
                        <time dateTime={review.createdAt}>
                          {formatInstant(new Date(review.createdAt))}
                        </time>
                      </TableCell>
                      <TableCell>
                        {review.current ? (
                          <Badge variant="progress">
                            {review.updated ? "Updated" : "Awaiting decision"}
                          </Badge>
                        ) : (
                          <Badge variant="stopped">{SAFETY_REVIEW_WITHDRAWN_LABEL}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function reviewCountCopy(filtered: number, total: number) {
  if (filtered !== total) return `Showing ${filtered} of ${total} safety reviews`;
  return total === 1 ? "1 safety review" : `${total} safety reviews`;
}
