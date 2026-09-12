import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { getCurrentUser } from "#/features/auth/session";
import { listVenues } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

const NAV_LINK =
  "text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground";

export const Route = createFileRoute("/venues/")({
  head: () =>
    createSeoHead({
      title: "Venues — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    if (!can(user.role, { venue: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }

    return { user };
  },
  loader: () => listVenues(),
  component: VenuesPage,
});

function VenuesPage() {
  const { user } = Route.useRouteContext();
  const venues = Route.useLoaderData();
  const canCreate = can(user.role, { venue: ["create"] });

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link to="/dashboard" className={NAV_LINK}>
        Back to dashboard
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Venues</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            ConnectSphere&apos;s rooms and spaces, as recorded by Venue Staff.
          </p>
        </div>
        {canCreate && (
          <Link
            to="/venues/new"
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New venue
          </Link>
        )}
      </div>

      {venues.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">No venues recorded yet.</p>
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border font-mono text-xs tracking-widest text-muted-foreground uppercase">
              <tr>
                <th className="py-3 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Location</th>
                <th className="py-3 pr-4 font-medium">Capacity</th>
                <th className="py-3 font-medium">Layouts</th>
              </tr>
            </thead>
            <tbody>
              {venues.map(venue => (
                <tr key={venue.id} className="border-b border-border">
                  <td className="py-3 pr-4">
                    <Link
                      to="/venues/$venueId"
                      params={{ venueId: String(venue.id) }}
                      className={NAV_LINK}
                    >
                      {venue.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{venue.location}</td>
                  <td className="py-3 pr-4">{venue.maxCapacity}</td>
                  <td className="py-3">{venue.supportedLayouts.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
