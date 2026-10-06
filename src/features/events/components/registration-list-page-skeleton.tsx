import { Page, PageHeader } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { Skeleton } from "#/components/ui/skeleton";

const REGISTRATION_CARDS = [0, 1];

export function RegistrationListPageSkeleton() {
  return (
    <Page width="wide" aria-busy="true">
      <output className="sr-only">Loading your registrations…</output>
      <Skeleton className="h-4 w-36" />
      <div className="mt-6">
        <PageHeader eyebrow="Attendee" title="My registrations" />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {REGISTRATION_CARDS.map(card => (
          <Card key={card}>
            <CardContent>
              <Skeleton className="h-6 w-3/4" />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Page>
  );
}
