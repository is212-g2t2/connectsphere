import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
import { IconActionLink } from "#/components/ui/icon-action";
import { Card, CardContent } from "#/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
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
import {
  createVenueSearchFormInput,
  crossesMidnight,
  layoutLabelForKey,
} from "#/features/venues/schema";
import type { VenueSearch, VenueSearchFormValues } from "#/features/venues/schema";
import type { VenueSearchResult } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * `filters` is `VenueSearch` with values already parsed. The input shape holds the same fields as
 * display strings. An absent number or time renders as an empty input.
 */
function toSearchFormValues(filters: VenueSearch): VenueSearchFormValues {
  return {
    eventId: filters.eventId === undefined ? "" : String(filters.eventId),
    date: filters.date ?? "",
    endDate: filters.endDate ?? "",
    startTime: filters.startTime ?? "",
    endTime: filters.endTime ?? "",
    expectedAttendance:
      filters.expectedAttendance === undefined ? "" : String(filters.expectedAttendance),
    capacity: filters.capacity === undefined ? "" : String(filters.capacity),
    location: filters.location ?? "",
    accessibility: filters.accessibility ?? "",
    layout: filters.layout ?? "",
    facilities: filters.facilities ?? "",
  };
}

/**
 * PTR-138 AC1: the search values that a suitable venue's link carries into its request form: the
 * date, the times when the search covers one day, and each session requirement that is set. A
 * request covers one day, so a multi-day search carries its first date only. An unsuitable venue's
 * link carries nothing, so the venue page offers it no request.
 */
export function requestSearch(eventId: number, filters: VenueSearch) {
  const oneDay = filters.endDate === undefined || filters.endDate === filters.date;
  const { date, startTime, endTime, expectedAttendance, layout, accessibility, facilities } =
    filters;
  return {
    eventId,
    ...(date === undefined ? {} : { date }),
    ...(date !== undefined && oneDay && startTime !== undefined && endTime !== undefined
      ? { startTime, endTime }
      : {}),
    ...(expectedAttendance === undefined ? {} : { expectedAttendance }),
    ...(layout ? { layout } : {}),
    ...(accessibility ? { accessibilityRequirements: accessibility } : {}),
    ...(facilities ? { requiredFacilities: facilities } : {}),
  };
}

/** One applied filter as the summary above the results shows it. */
export interface AppliedFilter {
  key: string;
  label: string;
  value: string;
}

/**
 * List the applied filters for the summary above the results. The event context is not a filter;
 * the "Prefilled from" line already names it.
 */
export function appliedFilters(filters: VenueSearch): AppliedFilter[] {
  const applied: AppliedFilter[] = [];
  if (filters.date !== undefined || filters.endDate !== undefined) {
    const range =
      filters.date !== undefined &&
      filters.endDate !== undefined &&
      filters.endDate !== filters.date
        ? `${filters.date} to ${filters.endDate}`
        : (filters.date ?? filters.endDate ?? "");
    applied.push({ key: "dates", label: "Dates", value: range });
  }
  if (filters.startTime !== undefined && filters.endTime !== undefined) {
    applied.push({ key: "time", label: "Time", value: `${filters.startTime}–${filters.endTime}` });
  }
  if (filters.expectedAttendance !== undefined) {
    applied.push({
      key: "expectedAttendance",
      label: "Expected attendance",
      value: String(filters.expectedAttendance),
    });
  }
  if (filters.capacity !== undefined) {
    applied.push({ key: "capacity", label: "Minimum capacity", value: String(filters.capacity) });
  }
  if (filters.location) {
    applied.push({ key: "location", label: "Location", value: filters.location });
  }
  if (filters.accessibility) {
    applied.push({ key: "accessibility", label: "Accessibility", value: filters.accessibility });
  }
  if (filters.layout) {
    applied.push({ key: "layout", label: "Layout", value: filters.layout });
  }
  if (filters.facilities) {
    applied.push({ key: "facilities", label: "Facilities", value: filters.facilities });
  }
  return applied;
}

const CRITERION_PHRASES: Record<string, string> = {
  capacity: "too small",
  location: "in the wrong place",
  layout: "missing the layout",
  accessibility: "missing accessibility features",
  facilities: "missing facilities",
  availability: "unavailable",
  booking: "already booked",
  hold: "already on hold",
};

/**
 * Summarise the unsuitable venues for the disclosure label: the count that fell short, then each
 * failed criterion with its venue count. Counts venues once per criterion. Names the searched
 * layout when the layout criterion fails.
 */
export function summariseUnsuitable(
  unsuitable: readonly { failures: readonly { criterion: string }[] }[],
  layoutFilter?: string
): string {
  const total = unsuitable.length;
  const counts = new Map<string, number>();
  for (const entry of unsuitable) {
    for (const criterion of new Set(entry.failures.map(failure => failure.criterion))) {
      counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
    }
  }
  const head = `${total} ${total === 1 ? "venue" : "venues"} fell short`;
  const parts = [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([criterion, count]) => {
      if (criterion === "layout" && layoutFilter) {
        return `${count} do not offer ${layoutFilter}`;
      }
      return `${count} ${CRITERION_PHRASES[criterion] ?? criterion}`;
    });
  return parts.length > 0 ? `${head}: ${parts.join(", ")}` : head;
}

/** Describe only the slice of a `form.Field` that a text row reads, as `venue-form.tsx` does. */
interface SearchFieldApi {
  name: string;
  state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** List what the ten plain fields vary by beyond their label. */
type SearchFieldOptions = Pick<
  React.ComponentProps<typeof Input>,
  "type" | "min" | "step" | "placeholder"
>;

/**
 * Every search field renders the same row: label, input, and error. Build the row once here.
 * Each `form.Field` hands its own `field` to the result. Keep `<form.Field>` at the call site so
 * `name` still checks against the form keys. That name also serves as the input `id`, which each
 * label points at. Every search field is optional, so each label says so.
 */
function searchField(label: string, options: SearchFieldOptions = {}) {
  return (field: SearchFieldApi) => (
    <Field>
      <FieldLabel htmlFor={field.name}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        {...options}
        value={field.state.value}
        onChange={event => field.handleChange(event.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={field.state.meta.errors.length > 0}
      />
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

type CatalogueSort = "name" | "capacity";

/**
 * Show the venue catalogue and PTR-29 search. Loader data and the session arrive as props, so the
 * page renders without a router. Only submitting or clearing filters navigates. Venue Staff see
 * the catalogue with a client-side filter and sort instead of the search form.
 */
export function VenueListPage({ user, result }: { user: SessionUser; result: VenueSearchResult }) {
  const navigate = useNavigate();
  const canCreate = can(user.role, { venue: ["create"] });
  const canSearch = can(user.role, { venue: ["search"] });
  const canUpdate = can(user.role, { venue: ["update"] });
  const { event, filters, venues, unsuitable, layouts } = result;
  const searchFormInput = createVenueSearchFormInput(layouts);

  const form = useForm({
    defaultValues: toSearchFormValues(filters),
    validators: { onSubmit: searchFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await navigate({ to: "/venues", search: searchFormInput.parse(value) });
        // The results sit below the fold. Focus the results heading so the change is
        // announced, then scroll it into view: focus alone leaves the viewport behind.
        resultsHeadingRef.current?.focus({ preventScroll: true });
        resultsHeadingRef.current?.scrollIntoView({ block: "start" });
      } catch (searchError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              searchError instanceof Error
                ? searchError.message
                : "Could not search venues. Try again.",
          },
        });
      }
    },
  });

  // Arrival, Clear filters, and back/forward all hand a new `filters`. Reset from it to keep the
  // controlled inputs in step. Re-rendering alone does not keep them in step. Remounting through a
  // route key would drop text the visitor is still typing.
  useEffect(() => {
    form.reset(toSearchFormValues(filters));
  }, [filters, form]);

  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("name");
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  // The catalogue has no server search, so filter and sort its rows on the client. Search results
  // keep the server order.
  const catalogue = useMemo(() => {
    const query = catalogueQuery.trim().toLocaleLowerCase("en");
    const rows =
      query === ""
        ? [...venues]
        : venues.filter(venue =>
            `${venue.name} ${venue.location}`.toLocaleLowerCase("en").includes(query)
          );
    return rows.toSorted((a, b) =>
      catalogueSort === "name" ? a.name.localeCompare(b.name, "en") : a.maxCapacity - b.maxCapacity
    );
  }, [venues, catalogueQuery, catalogueSort]);

  const rows = canSearch ? venues : catalogue;
  const summary = appliedFilters(filters);
  const hasFilters = summary.length > 0;
  const filteredCatalogue = !canSearch && catalogueQuery.trim() !== "";
  // PTR-30 criterion 5: venues that fall short say why once the search asks something of them.
  // A window that crosses midnight is the Coordinator's slip. It is not a venue failure.
  const showUnsuitable =
    (hasFilters || event !== null) && unsuitable.length > 0 && !crossesMidnight(filters);

  function clearAll() {
    form.reset(toSearchFormValues({}));
    void navigate({ to: "/venues", search: {} });
  }

  return (
    <Page width="wide">
      <PageHeader
        back={
          <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
            Back to dashboard
          </Link>
        }
        title="Venues"
        description={
          canSearch
            ? "Search ConnectSphere's rooms and spaces against an event's hard requirements."
            : "ConnectSphere's rooms and spaces, and what each one offers."
        }
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

            <form
              noValidate
              onSubmit={submitEvent => {
                submitEvent.preventDefault();
                void form.handleSubmit();
              }}
              className="space-y-6"
            >
              <fieldset>
                <legend className="display-h3">When</legend>
                <p className="mt-2 body-sm text-muted-foreground">
                  The time window repeats each day in the date range.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <form.Field name="date">{searchField("Date", { type: "date" })}</form.Field>
                  <form.Field name="endDate">
                    {searchField("End date", { type: "date" })}
                  </form.Field>
                  <form.Field name="startTime">
                    {searchField("Start time", { type: "time" })}
                  </form.Field>
                  <form.Field name="endTime">
                    {searchField("End time", { type: "time" })}
                  </form.Field>
                </div>
              </fieldset>

              <fieldset>
                <legend className="display-h3">Who and where</legend>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <form.Field name="expectedAttendance">
                    {searchField("Expected attendance", { type: "number", min: "1", step: "1" })}
                  </form.Field>
                  <form.Field name="capacity">
                    {searchField("Minimum capacity", { type: "number", min: "1", step: "1" })}
                  </form.Field>
                  <form.Field name="location">
                    {searchField("Location", { placeholder: "Building or area" })}
                  </form.Field>
                </div>
              </fieldset>

              <fieldset>
                <legend className="display-h3">Room requirements</legend>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <form.Field name="accessibility">
                    {searchField("Accessibility features", {
                      placeholder: "Comma-separated features",
                    })}
                  </form.Field>
                  <form.Field name="layout">
                    {searchField("Supported layout", {
                      placeholder: "Theatre, classroom, banquet…",
                    })}
                  </form.Field>
                  <form.Field name="facilities">
                    {searchField("Required facilities", {
                      placeholder: "Comma-separated facilities",
                    })}
                  </form.Field>
                </div>
              </fieldset>

              <form.Subscribe selector={state => state.errorMap.onSubmit}>
                {onSubmitError =>
                  typeof onSubmitError === "string" ? (
                    <p role="alert" className="body-sm text-destructive">
                      {onSubmitError}
                    </p>
                  ) : null
                }
              </form.Subscribe>

              <div className="flex flex-wrap gap-3">
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button type="submit" disabled={isSubmitting}>
                      Search venues
                    </Button>
                  )}
                </form.Subscribe>
                <Button type="button" variant="outline" onClick={clearAll} disabled={!hasFilters}>
                  Clear filters
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!canSearch && venues.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field className="min-w-52 flex-1">
            <FieldLabel htmlFor="catalogue-filter">Filter venues</FieldLabel>
            <Input
              id="catalogue-filter"
              type="search"
              placeholder="Filter by name or location"
              value={catalogueQuery}
              onChange={change => setCatalogueQuery(change.target.value)}
            />
          </Field>
          <Field className="w-44">
            <FieldLabel htmlFor="catalogue-sort">Sort venues</FieldLabel>
            <select
              id="catalogue-sort"
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 body-sm"
              value={catalogueSort}
              onChange={change =>
                setCatalogueSort(change.target.value === "capacity" ? "capacity" : "name")
              }
            >
              <option value="name">Name</option>
              <option value="capacity">Capacity</option>
            </select>
          </Field>
        </div>
      )}

      <section aria-label="Venue results" className={canSearch ? "mt-8" : undefined}>
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2
            id="venue-results-heading"
            ref={resultsHeadingRef}
            tabIndex={-1}
            className="display-h3"
          >
            Venue results
          </h2>
          <p className="body-sm text-muted-foreground">
            {filteredCatalogue
              ? `${rows.length} of ${venues.length} venues`
              : `${rows.length} ${rows.length === 1 ? "venue" : "venues"}`}
            {showUnsuitable ? ` suitable, ${unsuitable.length} not suitable` : ""}
          </p>
        </div>

        {hasFilters && (
          <section className="mb-4 flex flex-wrap items-center gap-2" aria-label="Applied filters">
            {summary.map(filter => (
              <span
                key={filter.key}
                className="rounded-full bg-muted px-3 py-1 caption text-muted-foreground"
              >
                {filter.label}: {filter.value}
              </span>
            ))}
            <Button type="button" variant="link" size="sm" onClick={clearAll}>
              Clear all
            </Button>
          </section>
        )}

        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              {crossesMidnight(filters) ? (
                <>
                  <EmptyTitle>A search window cannot cross midnight.</EmptyTitle>
                  <EmptyDescription>
                    Venue opening hours end on the same day. Choose an end time later than the start
                    time.
                  </EmptyDescription>
                </>
              ) : (
                <>
                  <EmptyTitle>
                    {showUnsuitable
                      ? "No venue meets every requirement."
                      : filteredCatalogue
                        ? "No venues match this filter."
                        : hasFilters
                          ? "No venues match these requirements."
                          : "No venues recorded yet."}
                  </EmptyTitle>
                  {showUnsuitable ? (
                    <EmptyDescription>See below why each fell short.</EmptyDescription>
                  ) : (
                    (hasFilters || filteredCatalogue) && (
                      <EmptyDescription>
                        Change or clear a requirement and search again.
                      </EmptyDescription>
                    )
                  )}
                </>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ul className="space-y-4 sm:hidden">
              {rows.map(venue => (
                <li key={venue.id}>
                  <Card>
                    <CardContent>
                      <Link
                        to="/venues/$venueId"
                        params={{ venueId: String(venue.id) }}
                        // Carry the event and the search's session so the detail page can offer
                        // PTR-31's booking request, prefilled.
                        search={event ? requestSearch(event.id, filters) : {}}
                        className={NAV_LINK_CLASSNAME}
                      >
                        {venue.name}
                      </Link>
                      {canUpdate && (
                        <span className="body-sm text-muted-foreground">
                          <IconActionLink
                            label="Edit"
                            icon={<Pencil />}
                            link={
                              <Link to="/venues/$venueId" params={{ venueId: String(venue.id) }} />
                            }
                          />
                        </span>
                      )}
                      <p className="body-sm mt-2 text-muted-foreground">{venue.location}</p>
                      <p className="body-sm mt-1">Capacity {venue.maxCapacity}</p>
                      <p className="body-sm mt-1 break-words">
                        <span className="text-muted-foreground">Facilities: </span>
                        {venue.facilities.join(", ") || "—"}
                      </p>
                      <p className="body-sm mt-1 break-words">
                        <span className="text-muted-foreground">Layouts: </span>
                        {venue.supportedLayouts
                          .map(key => layoutLabelForKey(key, layouts))
                          .join(", ") || "—"}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Key facilities</TableHead>
                    <TableHead>Layouts</TableHead>
                    {canUpdate && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(venue => {
                    const facilities = venue.facilities.join(", ");
                    const venueLayouts = venue.supportedLayouts
                      .map(key => layoutLabelForKey(key, layouts))
                      .join(", ");
                    return (
                      <TableRow key={venue.id}>
                        <TableCell>
                          <Link
                            to="/venues/$venueId"
                            params={{ venueId: String(venue.id) }}
                            // Carry the event and the search's session so the detail page can
                            // offer PTR-31's booking request, prefilled.
                            search={event ? requestSearch(event.id, filters) : {}}
                            className={NAV_LINK_CLASSNAME}
                          >
                            {venue.name}
                          </Link>
                        </TableCell>
                        <TableCell>{venue.location}</TableCell>
                        <TableCell>{venue.maxCapacity}</TableCell>
                        <TableCell
                          className="max-w-64 break-words whitespace-normal"
                          title={facilities || undefined}
                        >
                          {facilities || "—"}
                        </TableCell>
                        <TableCell
                          className="max-w-64 break-words whitespace-normal"
                          title={venueLayouts || undefined}
                        >
                          {venueLayouts || "—"}
                        </TableCell>
                        {canUpdate && (
                          <TableCell>
                            <IconActionLink
                              label="Edit"
                              icon={<Pencil />}
                              link={
                                <Link
                                  to="/venues/$venueId"
                                  params={{ venueId: String(venue.id) }}
                                />
                              }
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      {showUnsuitable && (
        <section aria-label="Not suitable" className="mt-8">
          <details className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer font-medium">
              {summariseUnsuitable(unsuitable, filters.layout)}
            </summary>
            <p className="body-sm mt-2 text-muted-foreground">
              Each venue below fails at least one requirement. A verdict books or blocks nothing;
              Venue Staff still decide any request.
            </p>
            <ul className="mt-3 space-y-2">
              {unsuitable.map(({ venue, failures }) => (
                <li key={venue.id} className="body-sm">
                  <Link
                    to="/venues/$venueId"
                    params={{ venueId: String(venue.id) }}
                    className={NAV_LINK_CLASSNAME}
                  >
                    {venue.name}
                  </Link>
                  <span className="text-muted-foreground">
                    {" — "}
                    {failures.map(failure => failure.message).join("; ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </Page>
  );
}
