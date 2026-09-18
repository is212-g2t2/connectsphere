import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { buttonVariants } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
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
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title="Venues"
        description="ConnectSphere's rooms and spaces, as recorded by Venue Staff."
        actions={
          canCreate ? (
            <Link to="/venues/new" className={buttonVariants()}>
              New venue
            </Link>
          ) : undefined
        }
      />

      {venues.length === 0 ? (
        <p className="mt-4 body-sm text-muted-foreground">No venues recorded yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Layouts</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {venues.map(venue => (
              <TableRow key={venue.id}>
                <TableCell>
                  <Link
                    to="/venues/$venueId"
                    params={{ venueId: String(venue.id) }}
                    className={NAV_LINK_CLASSNAME}
                  >
                    {venue.name}
                  </Link>
                </TableCell>
                <TableCell>{venue.location}</TableCell>
                <TableCell>{venue.maxCapacity}</TableCell>
                {/* Through `LAYOUT_LABELS` so the catalogue reads "Theatre, Banquet" like the
                    detail view, rather than the raw enum keys the column stores. */}
                <TableCell>
                  {venue.supportedLayouts.map(layout => LAYOUT_LABELS[layout]).join(", ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
