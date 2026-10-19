import { Page } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

const BOOKING_CARDS = [0, 1, 2];

/**
 * Reserve space for the heading and cards of a Venue Staff queue while they load: the approved
 * bookings, or the hold requests (PTR-150).
 */
export function VenueBookingsSkeleton({
  label = "Loading approved bookings…",
}: {
  label?: string;
}) {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">{label}</output>

      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-8 w-72" />
      <Skeleton className="mt-3 h-4 w-full max-w-3xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-xl" />

      <div className="mt-8 grid gap-4">
        {BOOKING_CARDS.map(card => (
          <Card key={card}>
            <CardContent>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-3 h-6 w-full max-w-sm" />
                  <Skeleton className="mt-3 h-4 w-full max-w-lg" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-9 w-20" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}
