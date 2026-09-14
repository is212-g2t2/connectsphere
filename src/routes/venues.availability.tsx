import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { can } from "#/features/auth/permissions";
import { getCurrentUser } from "#/features/auth/session";
import { AvailabilityCalendar } from "#/features/venues/calendar";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/venues/availability")({
  head: () => createSeoHead({ title: "Venue availability — ConnectSphere", noindex: true }),
  beforeLoad: async () => {
    const user = await getCurrentUser();
    if (!user) throw redirect({ to: "/login" });
    return { canViewAvailability: can(user.role, { venueAvailability: ["read"] }) };
  },
  component: VenueAvailabilityPage,
});

function VenueAvailabilityPage() {
  const { canViewAvailability } = Route.useRouteContext();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link
        to="/dashboard"
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Back to dashboard
      </Link>
      {canViewAvailability ? (
        <>
          <h1 className="mt-6 font-semibold">Venue availability</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Check when a venue is free and see its available and blocked periods.
          </p>
          <AvailabilityCalendar />
        </>
      ) : (
        <>
          <h1 className="mt-6 font-semibold">Access denied</h1>
          <p className="mt-3 text-muted-foreground">
            Your account does not have access to venue availability.
          </p>
        </>
      )}
    </main>
  );
}
