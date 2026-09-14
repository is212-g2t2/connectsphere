import { Link } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { LAYOUT_LABELS } from "#/features/venues/schema";
import type { Venue } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The venue catalogue. The rows come from the route's loader and the session user from its
 * context, both as props, so the table renders in a unit test without a router (PTR-75).
 */
export function VenueListPage({ user, venues }: { user: SessionUser; venues: Venue[] }) {
  const canCreate = can(user.role, { venue: ["create"] });

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
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
                      className={NAV_LINK_CLASSNAME}
                    >
                      {venue.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">{venue.location}</td>
                  <td className="py-3 pr-4">{venue.maxCapacity}</td>
                  {/* Through `LAYOUT_LABELS` so the catalogue reads "Theatre, Banquet" like the
                      detail view, rather than the raw enum keys the column stores. */}
                  <td className="py-3">
                    {venue.supportedLayouts.map(layout => LAYOUT_LABELS[layout]).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
