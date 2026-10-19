import { useEffect } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
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
 * label points at.
 */
function searchField(label: string, options: SearchFieldOptions = {}) {
  return (field: SearchFieldApi) => (
    <Field>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
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

/**
 * Show the venue catalogue and PTR-29 search. Loader data and the session arrive as props, so the
 * page renders without a router. Only submitting or clearing filters navigates.
 */
export function VenueListPage({ user, result }: { user: SessionUser; result: VenueSearchResult }) {
  const navigate = useNavigate();
  const canCreate = can(user.role, { venue: ["create"] });
  const canSearch = can(user.role, { venue: ["search"] });
  const { event, filters, venues, unsuitable, layouts } = result;
  const searchFormInput = createVenueSearchFormInput(layouts);

  const form = useForm({
    defaultValues: toSearchFormValues(filters),
    validators: { onSubmit: searchFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await navigate({ to: "/venues", search: searchFormInput.parse(value) });
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

  const hasFilters = Object.keys(filters).some(key => key !== "eventId");
  // PTR-30 criterion 5: venues that fall short say why once the search asks something of them.
  // A window that crosses midnight is the Coordinator's slip. It is not a venue failure.
  const showUnsuitable =
    (hasFilters || event !== null) && unsuitable.length > 0 && !crossesMidnight(filters);

  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
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
              className="space-y-5"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <form.Field name="date">{searchField("Date", { type: "date" })}</form.Field>
                <form.Field name="endDate">{searchField("End date", { type: "date" })}</form.Field>
                <form.Field name="startTime">
                  {searchField("Start time", { type: "time" })}
                </form.Field>
                <form.Field name="endTime">{searchField("End time", { type: "time" })}</form.Field>
                <form.Field name="expectedAttendance">
                  {searchField("Expected attendance", { type: "number", min: "1", step: "1" })}
                </form.Field>
                <form.Field name="location">
                  {searchField("Location", { placeholder: "Building or area" })}
                </form.Field>
                <form.Field name="capacity">
                  {searchField("Minimum capacity", { type: "number", min: "1", step: "1" })}
                </form.Field>
                <form.Field name="accessibility">
                  {searchField("Accessibility features", {
                    placeholder: "Comma-separated features",
                  })}
                </form.Field>
                <form.Field name="layout">
                  {searchField("Supported layout", { placeholder: "Theatre, classroom, banquet…" })}
                </form.Field>
                <form.Field name="facilities">
                  {searchField("Required facilities", {
                    placeholder: "Comma-separated facilities",
                  })}
                </form.Field>
              </div>

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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset(toSearchFormValues({}));
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
            {showUnsuitable ? ` suitable, ${unsuitable.length} not suitable` : ""}
          </p>
        </div>

        {venues.length === 0 ? (
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
                      : hasFilters
                        ? "No venues match these requirements."
                        : "No venues recorded yet."}
                  </EmptyTitle>
                  {showUnsuitable ? (
                    <EmptyDescription>See below why each fell short.</EmptyDescription>
                  ) : (
                    hasFilters && (
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
                      // Carry the event and the search's session so the detail page can offer
                      // PTR-31's booking request, prefilled.
                      search={event ? requestSearch(event.id, filters) : {}}
                      className={NAV_LINK_CLASSNAME}
                    >
                      {venue.name}
                    </Link>
                  </TableCell>
                  <TableCell>{venue.location}</TableCell>
                  <TableCell>{venue.maxCapacity}</TableCell>
                  <TableCell>{venue.facilities.join(", ") || "—"}</TableCell>
                  <TableCell>
                    {venue.supportedLayouts
                      .map(key => layoutLabelForKey(key, layouts))
                      .join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {showUnsuitable && (
        <section aria-labelledby="unsuitable-heading" className="mt-8">
          <h2 id="unsuitable-heading" className="display-h3">
            Not suitable
          </h2>
          <p className="body-sm mt-2 text-muted-foreground">
            Each venue below fails at least one requirement. A verdict books or blocks nothing;
            Venue Staff still decide any request.
          </p>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">Name</TableHead>
                <TableHead>Why not</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unsuitable.map(({ venue, failures }) => (
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
                  <TableCell className="whitespace-normal">
                    <ul className="space-y-1">
                      {failures.map(failure => (
                        <li key={failure.criterion}>{failure.message}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </Page>
  );
}
