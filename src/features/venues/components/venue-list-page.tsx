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
import { LAYOUT_LABELS, VenueSearchSchema, crossesMidnight } from "#/features/venues/schema";
import type { VenueSearch } from "#/features/venues/schema";
import type { VenueSearchResult } from "#/features/venues/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** What the inputs hold: every value a string, converted to `VenueSearch` only on submit. */
type VenueSearchFormValues = Record<keyof VenueSearch, string>;

/**
 * `filters` is `VenueSearch`, whose values arrive already parsed; the input shape is the same
 * fields as display strings, with an absent number or time rendered as an empty input.
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

interface VenueSearchFormErrors {
  fields: Record<string, { message: string }[]>;
}

/**
 * Validation lives here, not in the route: `VenueSearchSchema` is the same gate the server uses,
 * so every issue it names marks its own field, exactly as `venue-form.tsx` maps `VenueInput`.
 */
function validateSearch(value: VenueSearchFormValues): VenueSearchFormErrors | undefined {
  const parsed = VenueSearchSchema.safeParse(value);
  if (parsed.success) {
    return undefined;
  }

  const fields: VenueSearchFormErrors["fields"] = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.filter(segment => typeof segment === "string").join(".");
    (fields[path] ??= []).push({ message: issue.message });
  }

  return { fields };
}

/** Only the slice of a `form.Field` a text row reads, as `venue-form.tsx` describes it. */
interface SearchFieldApi {
  name: string;
  state: { value: string; meta: { errors: Array<{ message?: string } | undefined> } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** What the ten plain fields vary by beyond their label. */
type SearchFieldOptions = Pick<
  React.ComponentProps<typeof Input>,
  "type" | "min" | "step" | "placeholder"
>;

/**
 * Every search field renders the same row — label, input, error — so the row is built once here
 * and each `form.Field` hands its own `field` to the result. The `<form.Field>` stays at the call
 * site so `name` is still checked against the form's own keys, and that name doubles as the
 * input's `id`, which is what every label points at.
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
 * The venue catalogue and PTR-29 search. Loader data and the session arrive as props so the page
 * remains renderable without a router; only submitting or clearing filters navigates.
 */
export function VenueListPage({ user, result }: { user: SessionUser; result: VenueSearchResult }) {
  const navigate = useNavigate();
  const canCreate = can(user.role, { venue: ["create"] });
  const canSearch = can(user.role, { venue: ["search"] });
  const { event, filters, venues } = result;

  const form = useForm({
    defaultValues: toSearchFormValues(filters),
    validators: { onSubmit: ({ value }) => validateSearch(value) },
    onSubmit: async ({ value, formApi }) => {
      try {
        await navigate({ to: "/venues", search: VenueSearchSchema.parse(value) });
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

  // Arrival, Clear filters and back/forward all hand a new `filters`; resetting from it keeps the
  // controlled inputs in step. Re-rendering alone does not, and remounting via a route key would
  // drop whatever the visitor was mid-way through typing.
  useEffect(() => {
    form.reset(toSearchFormValues(filters));
  }, [filters, form]);

  const hasFilters = Object.keys(filters).some(key => key !== "eventId");

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
                    {hasFilters ? "No venues match these requirements." : "No venues recorded yet."}
                  </EmptyTitle>
                  {hasFilters && (
                    <EmptyDescription>
                      Change or clear a requirement and search again.
                    </EmptyDescription>
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
