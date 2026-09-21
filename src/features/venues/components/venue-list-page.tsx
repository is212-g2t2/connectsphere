import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
import { LAYOUT_LABELS, VenueSearchSchema } from "#/features/venues/schema";
import type { VenueSearchResult } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The venue catalogue and PTR-29 search. Loader data and the session arrive as props so the page
 * remains renderable without a router; only submitting or clearing filters navigates.
 */
export function VenueListPage({ user, result }: { user: SessionUser; result: VenueSearchResult }) {
  const navigate = useNavigate();
  const canCreate = can(user.role, { venue: ["create"] });
  const canSearch = can(user.role, { venue: ["search"] });
  const { event, filters, venues } = result;
  const [error, setError] = useState<string | null>(null);

  const hasFilters = Object.keys(filters).some(key => key !== "eventId");

  function submit(searchEvent: React.FormEvent<HTMLFormElement>) {
    searchEvent.preventDefault();
    const parsed = VenueSearchSchema.safeParse(
      Object.fromEntries(new FormData(searchEvent.currentTarget))
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    void navigate({ to: "/venues", search: parsed.data });
  }

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        title="Venues"
        description="Search ConnectSphere's rooms and spaces against an event's hard requirements."
        actions={
          canCreate ? (
            <Link to="/venues/new" className={buttonVariants()}>
              New venue
            </Link>
          ) : undefined
        }
      />

      {canSearch && (
        <Card>
          <CardContent>
            <div className="mb-6">
              <h2 className="display-h3">Search venues</h2>
              <p className="mt-2 body-sm text-muted-foreground">
                Every result must satisfy every requirement you apply.
              </p>
              {event && <p className="mt-2 body-sm font-medium">Prefilled from {event.name}</p>}
            </div>

            <form noValidate onSubmit={submit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SearchField label="Date" name="date">
                  <Input id="date" name="date" type="date" defaultValue={filters.date} />
                </SearchField>
                <SearchField label="End date" name="endDate">
                  <Input id="endDate" name="endDate" type="date" defaultValue={filters.endDate} />
                </SearchField>
                <SearchField label="Start time" name="startTime">
                  <Input
                    id="startTime"
                    name="startTime"
                    type="time"
                    defaultValue={filters.startTime}
                  />
                </SearchField>
                <SearchField label="End time" name="endTime">
                  <Input id="endTime" name="endTime" type="time" defaultValue={filters.endTime} />
                </SearchField>
                <SearchField label="Expected attendance" name="expectedAttendance">
                  <Input
                    id="expectedAttendance"
                    name="expectedAttendance"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={filters.expectedAttendance}
                  />
                </SearchField>
                <SearchField label="Location" name="location">
                  <Input
                    id="location"
                    name="location"
                    defaultValue={filters.location}
                    placeholder="Building or area"
                  />
                </SearchField>
                <SearchField label="Minimum capacity" name="capacity">
                  <Input
                    id="capacity"
                    name="capacity"
                    type="number"
                    min="1"
                    step="1"
                    defaultValue={filters.capacity}
                  />
                </SearchField>
                <SearchField label="Accessibility features" name="accessibility">
                  <Input
                    id="accessibility"
                    name="accessibility"
                    defaultValue={filters.accessibility}
                    placeholder="Comma-separated features"
                  />
                </SearchField>
                <SearchField label="Supported layout" name="layout">
                  <Input
                    id="layout"
                    name="layout"
                    defaultValue={filters.layout}
                    placeholder="Theatre, classroom, banquet…"
                  />
                </SearchField>
                <SearchField label="Required facilities" name="facilities">
                  <Input
                    id="facilities"
                    name="facilities"
                    defaultValue={filters.facilities}
                    placeholder="Comma-separated facilities"
                  />
                </SearchField>
              </div>

              {error && (
                <p role="alert" className="body-sm text-destructive">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button type="submit">Search venues</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clickEvent => {
                    clickEvent.currentTarget.form?.reset();
                    setError(null);
                    void navigate({ to: "/venues", search: {} });
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section aria-label="Venue results" className={canSearch ? "mt-8" : undefined}>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 className="display-h3">Venue results</h2>
          <p className="body-sm text-muted-foreground">
            {venues.length} {venues.length === 1 ? "venue" : "venues"}
          </p>
        </div>

        {venues.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {hasFilters ? "No venues match these requirements." : "No venues recorded yet."}
              </EmptyTitle>
              {hasFilters && (
                <EmptyDescription>Change or clear a requirement and search again.</EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Key facilities</TableHead>
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
                  <TableCell>{venue.facilities.join(", ") || "—"}</TableCell>
                  <TableCell>
                    {venue.supportedLayouts.map(layout => LAYOUT_LABELS[layout]).join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </Page>
  );
}

function SearchField({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}
