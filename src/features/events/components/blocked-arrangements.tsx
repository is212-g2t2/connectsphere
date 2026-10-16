import { Fragment, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button, buttonVariants } from "#/components/ui/button";
import { formatVenueBlockPeriod, formatVenuePeriod } from "#/features/event-requests/format";
import { skipRootFilter } from "#/lib/invalidate";
import type { BlockedArrangement } from "#/features/events/access";
import { releaseBlockedVenueBooking } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * PTR-137 AC1, AC3, AC4: the bookings and holds a live venue block has suspended, with the
 * block's reason, for the assigned Coordinator. Each stays recorded — a booking as approved, a
 * hold as held — but reserves nothing while the block stands. The Coordinator either waits for
 * the lift, which restores the arrangement, or finds a replacement through the venue search and
 * then releases the suspended booking, so the lift leaves the replacement standing.
 */
export function BlockedArrangements({
  eventId,
  arrangements,
  searchable = true,
}: {
  eventId: number;
  arrangements: BlockedArrangement[];
  /** PTR-137 AC3: whether the event's status still accepts a venue request. */
  searchable?: boolean;
}) {
  if (arrangements.length === 0) return null;
  // Only a suspended booking holds confirmation back, and only a booking can be released: a
  // hold-only block leaves the event's own booking intact, so the copy and steps differ.
  const hasSuspendedBooking = arrangements.some(arrangement => arrangement.kind === "booking");
  return (
    <section
      className="mt-4 rounded-md border border-border bg-muted/40 p-4"
      aria-labelledby="blocked-arrangements-heading"
    >
      <h3 id="blocked-arrangements-heading" tabIndex={-1} className="display-h3 outline-none">
        Venue blocked
      </h3>
      <p className="mt-2 body-sm text-muted-foreground">
        A venue block suspends these arrangements. They stay recorded but reserve nothing until
        Venue Staff lift the block.
        {hasSuspendedBooking ? " You cannot confirm the event on a suspended booking." : ""}
      </p>
      {hasSuspendedBooking ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 body-sm text-muted-foreground">
          <li>Find and request a replacement venue, or wait for Venue Staff to lift the block.</li>
          <li>Once Venue Staff approve a replacement, release the suspended booking below.</li>
          <li>Confirm the event again.</li>
        </ol>
      ) : (
        <p className="mt-2 body-sm text-muted-foreground">
          Wait for Venue Staff to lift the block, or find and request a replacement venue.
        </p>
      )}
      {searchable && (
        <div className="mt-4">
          <Link
            to="/venues"
            search={{ eventId }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Find a replacement venue
          </Link>
        </div>
      )}
      <ul className="mt-4 space-y-4 border-t border-border pt-4">
        {arrangements.map(arrangement => (
          <li key={`${arrangement.kind}-${arrangement.id}`} className="body-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="stopped">
                {arrangement.kind === "booking" ? "Booking suspended" : "Hold suspended"}
              </Badge>
              <h4 className="min-w-0 font-medium break-words">
                {arrangement.venueName},{" "}
                {formatVenuePeriod(arrangement.startsAt, arrangement.endsAt)}
              </h4>
            </div>
            <dl
              className="mt-2 grid gap-3 sm:grid-cols-2"
              aria-label={`${arrangement.venueName}, ${formatVenuePeriod(arrangement.startsAt, arrangement.endsAt)}`}
            >
              {/* One pair per block: two live blocks can suspend different pieces of one booking. */}
              {arrangement.blocks.map(block => (
                <Fragment key={`${block.startsAt}-${block.reason}`}>
                  <div className="min-w-0">
                    <dt className="eyebrow text-muted-foreground">Block reason</dt>
                    <dd className="mt-1 break-words whitespace-pre-line">{block.reason}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="eyebrow text-muted-foreground">Block period</dt>
                    <dd className="mt-1 break-words">
                      {formatVenueBlockPeriod(block.startsAt, block.endsAt)}
                    </dd>
                  </div>
                </Fragment>
              ))}
            </dl>
            {arrangement.kind === "booking" && <ReleaseBlockedBooking arrangement={arrangement} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * PTR-137 AC4: release a suspended booking once a replacement is arranged, so the lift does not
 * bring it back. The server refuses a booking that is no longer suspended.
 */
function ReleaseBlockedBooking({ arrangement }: { arrangement: BlockedArrangement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [release, run, releasing] = useMutation(async () => {
    await releaseBlockedVenueBooking({ data: { id: arrangement.id } });
    setOpen(false);
    toast.success("Booking released. The Venue Staff who settled it will be notified.");
    await router.invalidate({ filter: skipRootFilter });
    // The released row leaves the list. Focus the panel, or the venue heading when the panel
    // itself is gone, so readers hear the change instead of landing on the page body.
    const focusTarget =
      document.getElementById("blocked-arrangements-heading") ??
      document.getElementById("venue-section-heading");
    focusTarget?.focus();
  }, "Could not release this booking. Try again.");

  return (
    <div className="mt-3">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <Button
              variant="destructive"
              size="sm"
              disabled={releasing}
              aria-label={`Release this booking: ${arrangement.venueName}`}
            />
          }
        >
          Release this booking
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Release the suspended booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {arrangement.venueName}, {formatVenuePeriod(arrangement.startsAt, arrangement.endsAt)}{" "}
              will not come back when the block is lifted. Release it only after Venue Staff approve
              a replacement venue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={releasing}>
              Keep booking
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              variant="destructive"
              disabled={releasing}
              onClick={() => void run()}
            >
              {releasing ? "Releasing…" : "Release booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
          {release.status === "error" ? (
            <p role="alert" className="body-sm text-destructive">
              {release.error}
            </p>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
