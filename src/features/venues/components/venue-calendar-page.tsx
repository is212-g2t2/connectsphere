import { useEffect, useMemo, useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Calendar, CalendarDayButton } from "#/components/ui/calendar";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { can } from "#/features/auth/permissions";
import { formatLocalDate, formatLocalDateTime } from "#/features/event-requests/format";
import type { SessionUser } from "#/features/auth/session";
import {
  ConvertVenueHoldButton,
  ReleaseVenueHoldButton,
  RequestVenueHoldDialog,
  WithdrawVenueHoldRequestButton,
} from "#/features/venue-requests/components/venue-hold-actions";
import {
  LiftVenueBlockButton,
  RecordVenueBlockDialog,
} from "#/features/venues/components/venue-block-actions";
import {
  SetVenueHoldExpiryButton,
  SetVenueHoldWarningButton,
} from "#/features/venue-requests/components/hold-time-dialog";
import type { CoordinatorEventOption } from "#/features/venue-requests/components/venue-hold-actions";
import {
  closedDaysInRange,
  compareTimestamps,
  nextCivilDate,
  timestampDay,
  timestampEndDay,
  timestampTime,
} from "#/features/venues/availability";
import type { OccupiedPeriod } from "#/features/venues/availability";
import {
  VENUE_HOLD_REQUEST_LABEL,
  VENUE_HOLD_REQUEST_NOTE,
} from "#/features/venue-requests/schema";
import { AvailabilitySelectionFormInput } from "#/features/venues/schema";
import type { AvailabilitySearch, RoomLayout } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";
import { cn, NAV_LINK_CLASSNAME } from "#/lib/utils";

export const MONTH_FOCUS_KEY = "connectsphere.venue-calendar.focus-month";

function rememberMonthFocus(day: string) {
  try {
    sessionStorage.setItem(MONTH_FOCUS_KEY, day);
  } catch {
    // Focus restoration is optional. Storage can be blocked.
  }
}

function takeMonthFocus() {
  try {
    const target = sessionStorage.getItem(MONTH_FOCUS_KEY);
    sessionStorage.removeItem(MONTH_FOCUS_KEY);
    return target;
  } catch {
    return null;
  }
}

function clearMonthFocus() {
  try {
    sessionStorage.removeItem(MONTH_FOCUS_KEY);
  } catch {
    // Focus restoration is optional. Storage can be blocked.
  }
}

const OCCUPIED_STATES = {
  confirmed: {
    variant: "confirmed",
    label: "Confirmed booking",
    dotColor: "bg-harbor",
  },
  tentative_hold: {
    variant: "progress",
    label: "Tentative hold",
    dotColor: "bg-amber",
  },
  blocked: {
    variant: "stopped",
    label: "Unavailable / blocked",
    dotColor: "bg-coral",
  },
} as const satisfies Record<
  OccupiedPeriod["state"],
  {
    variant: React.ComponentProps<typeof Badge>["variant"];
    label: string;
    dotColor: string;
  }
>;

/** One formatter per shape. Construction parses its options, so reuse the instance. */
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/**
 * One row of the results list. The row shows `visibleStart` to `visibleEnd`, the part inside the
 * range. The lift confirmation names the record's true `startsAt` to `endsAt`.
 */
type CalendarRow = Omit<OccupiedPeriod, "id" | "state"> & {
  key: string;
  id?: string;
  state: OccupiedPeriod["state"] | "available" | "closed";
};

/**
 * Show the venue calendar (PTR-28). Accept a venue and an inclusive date range. Return free,
 * confirmed, and blocked periods. The rows and the calendar come from the route loader, and the
 * applied search comes from the route, both as props. The page then renders in a unit test
 * without a router (PTR-75). Selecting a range navigates to the same route with new search
 * parameters. That navigation re-runs the loader, so no fetch state needs to stay in step.
 */
export function VenueCalendarPage({
  venues,
  schedule,
  search,
  layouts,
  user,
  coordinatorEvents,
}: {
  venues: Venue[];
  schedule: VenueAvailability | null;
  search: AvailabilitySearch;
  /** The maintained list. Hold conversion refuses a typo against it. */
  layouts?: readonly RoomLayout[];
  user?: SessionUser | null;
  coordinatorEvents?: readonly CoordinatorEventOption[];
}) {
  const navigate = useNavigate();
  const form = useForm({
    defaultValues: {
      venueId: search.venueId === undefined ? "" : String(search.venueId),
      startDate: search.startDate ?? "",
      endDate: search.endDate ?? "",
    },
    validators: {
      onSubmit: AvailabilitySelectionFormInput,
    },
    onSubmit: async ({ value, formApi }) => {
      clearMonthFocus();
      try {
        await navigate({
          to: "/venues/availability",
          search: AvailabilitySelectionFormInput.parse(value),
        });
      } catch (submitError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              submitError instanceof Error
                ? submitError.message
                : "Could not load availability. Try again.",
          },
        });
      }
    },
  });

  const month = search.startDate ? civilDate(search.startDate) : undefined;

  const calendarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const target = takeMonthFocus();
    if (target === search.startDate) calendarRef.current?.focus();
  }, [search.startDate]);

  const showMonth = (next: Date) => {
    const range = monthRange(next);
    rememberMonthFocus(range.startDate);
    void navigate({
      to: "/venues/availability",
      search: { venueId: search.venueId, ...range },
    });
  };

  // The schedule names the venue but carries no hours. Read them from the catalogue.
  const venueOperatingHours = venues.find(venue => venue.id === schedule?.venue.id)?.operatingHours;

  // Derive the day map, the picker modifiers, and the sorted rows once per schedule.
  // Typing a filter re-renders without rebuilding them.
  const { occupiedModifiers, closedDays, bufferDays, periods } = useMemo(() => {
    const occupiedDays = new Map<string, OccupiedPeriod["state"]>();
    for (const period of schedule?.occupied ?? []) {
      for (
        let day = timestampDay(period.visibleStart);
        day <= timestampEndDay(period.visibleEnd);
        day = nextCivilDate(day)
      ) {
        if (!occupiedDays.has(day)) occupiedDays.set(day, period.state);
      }
    }

    const modifiers: Record<OccupiedPeriod["state"], Date[]> = {
      confirmed: [],
      tentative_hold: [],
      blocked: [],
    };
    for (const [day, state] of occupiedDays) modifiers[state].push(civilDate(day));

    // A day with a buffer conflict keeps its occupied mark. Collect it separately so the grid
    // can outline it without changing the dot.
    const conflicted = new Set<string>();
    for (const period of schedule?.occupied ?? []) {
      if (!period.bufferConflict) continue;
      for (
        let day = timestampDay(period.visibleStart);
        day <= timestampEndDay(period.visibleEnd);
        day = nextCivilDate(day)
      ) {
        conflicted.add(day);
      }
    }

    const closed =
      schedule && venueOperatingHours
        ? closedDaysInRange(venueOperatingHours, schedule.startDate, schedule.endDate)
        : [];

    const rows: CalendarRow[] = schedule
      ? [
          ...schedule.available.map(period => ({
            key: `available:${period.startsAt}`,
            label: "Available",
            state: "available" as const,
            startsAt: period.startsAt,
            endsAt: period.endsAt,
            visibleStart: period.startsAt,
            visibleEnd: period.endsAt,
          })),
          // A block can split one booking or hold into active pieces that share its id. Key by
          // the visible start too, so both pieces render.
          ...schedule.occupied.map(period => ({
            key: `${period.state}:${period.id}:${period.visibleStart}`,
            ...period,
          })),
          // A day with no operating window reads Closed, even when a record also covers it.
          ...closed.map(day => ({
            key: `closed:${day}`,
            label: "Closed",
            state: "closed" as const,
            startsAt: `${day}T00:00:00`,
            endsAt: `${day}T00:00:00`,
            visibleStart: `${day}T00:00:00`,
            visibleEnd: `${day}T00:00:00`,
          })),
        ].toSorted((left, right) => compareTimestamps(left.visibleStart, right.visibleStart))
      : [];
    return {
      occupiedModifiers: modifiers,
      closedDays: closed,
      bufferDays: [...conflicted].map(civilDate),
      periods: rows,
    };
  }, [schedule, venueOperatingHours]);

  const canHold = user ? can(user.role, { venue_request: ["request"] }) : false;
  const canSetExpiry = user ? can(user.role, { venue_request: ["decide"] }) : false;
  const canBlock = user ? can(user.role, { venue: ["update"] }) : false;
  // PTR-151: a requested hold shows here but reserves no venue time, so it changes no period.
  const requestedHolds = schedule?.requestedHolds ?? [];
  // Only key the legend on marks the grid shows. Unmarked days read as unmarked, not free.
  // Available periods name themselves in the results list; the grid draws no mark for them.
  const legend = {
    confirmed: occupiedModifiers.confirmed.length > 0,
    tentativeHold: occupiedModifiers.tentative_hold.length > 0,
    blocked: occupiedModifiers.blocked.length > 0,
    bufferConflict: bufferDays.length > 0,
    closed: closedDays.length > 0,
  };
  const modifiers = {
    ...occupiedModifiers,
    closed: closedDays.map(civilDate),
    bufferConflict: bufferDays,
  };
  return (
    <Page width="wide">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        eyebrow="Venues"
        title="Venue calendar"
        description="Pick a venue and a date range to see when it can be requested — its free periods, confirmed bookings, tentative holds and recorded unavailability."
      />

      <div className="grid items-start gap-8 split:grid-cols-[1.6fr_1fr]">
        <section
          aria-label="Availability filters"
          className="min-w-0 split:col-start-1 split:row-start-1"
        >
          <Card>
            <CardContent>
              {venues.length === 0 ? (
                <p className="body-sm text-muted-foreground">No venues recorded yet.</p>
              ) : (
                <form
                  className="space-y-5"
                  noValidate
                  onSubmit={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void form.handleSubmit();
                  }}
                >
                  <form.Field name="venueId">
                    {field => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="availability-venue">Venue</FieldLabel>
                        <Select
                          value={field.state.value === "" ? null : field.state.value}
                          onValueChange={value => field.handleChange(value ?? "")}
                        >
                          <SelectTrigger
                            id="availability-venue"
                            className="w-full"
                            aria-invalid={field.state.meta.errors.length > 0}
                            onBlur={field.handleBlur}
                          >
                            <SelectValue>
                              {(value: string | null) =>
                                venues.find(option => String(option.id) === value)?.name ??
                                "Select a venue"
                              }
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {venues.map(venue => (
                              <SelectItem key={venue.id} value={String(venue.id)}>
                                {venue.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <form.Field name="startDate">
                      {field => (
                        <Field
                          className="min-w-0"
                          data-invalid={field.state.meta.errors.length > 0}
                        >
                          <FieldLabel htmlFor="availability-start">Start date</FieldLabel>
                          <Input
                            id="availability-start"
                            type="date"
                            value={field.state.value}
                            onChange={event => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                            aria-invalid={field.state.meta.errors.length > 0}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="endDate">
                      {field => (
                        <Field
                          className="min-w-0"
                          data-invalid={field.state.meta.errors.length > 0}
                        >
                          <FieldLabel htmlFor="availability-end">End date</FieldLabel>
                          <Input
                            id="availability-end"
                            type="date"
                            value={field.state.value}
                            onChange={event => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                            aria-invalid={field.state.meta.errors.length > 0}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </form.Field>
                  </div>
                  <form.Subscribe selector={state => [state.isSubmitting, state.errorMap.onSubmit]}>
                    {([isSubmitting, onSubmitError]) => (
                      <>
                        {typeof onSubmitError === "string" ? (
                          <p role="alert" className="body-sm text-destructive">
                            {onSubmitError}
                          </p>
                        ) : null}
                        <Button
                          type="submit"
                          className="w-full sm:w-auto"
                          disabled={Boolean(isSubmitting)}
                        >
                          {isSubmitting ? "Loading…" : "Show availability"}
                        </Button>
                      </>
                    )}
                  </form.Subscribe>
                </form>
              )}
            </CardContent>
          </Card>
        </section>

        {schedule ? (
          <section
            ref={calendarRef}
            aria-label={month ? `Calendar for ${MONTH_YEAR.format(month)}` : "Calendar"}
            tabIndex={-1}
            className="min-w-0 split:col-start-2 split:row-start-1 split:row-span-2"
          >
            <Card>
              <CardContent>
                <form.Subscribe selector={state => [state.values.startDate, state.values.endDate]}>
                  {([startDate, endDate]) => {
                    const selected = {
                      from: startDate ? civilDate(startDate) : undefined,
                      to:
                        endDate && startDate && endDate >= startDate
                          ? civilDate(endDate)
                          : undefined,
                    };
                    return (
                      <Calendar
                        mode="range"
                        timeZone="UTC"
                        locale={{ code: "en-GB" }}
                        className="mx-auto w-full [--cell-size:2.5rem] split:[--cell-size:2rem] lg:[--cell-size:2.5rem] xl:[--cell-size:2.75rem]"
                        selected={selected}
                        month={month}
                        onMonthChange={showMonth}
                        modifiers={modifiers}
                        onSelect={range => {
                          form.setFieldValue("startDate", range?.from ? civilDay(range.from) : "");
                          form.setFieldValue("endDate", range?.to ? civilDay(range.to) : "");
                        }}
                        components={{ DayButton: OccupiedDayButton }}
                      />
                    );
                  }}
                </form.Subscribe>
                <ul
                  aria-label="Availability legend"
                  className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 body-sm text-muted-foreground"
                >
                  {legend.confirmed ? (
                    <li className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn("size-2 rounded-full", OCCUPIED_STATES.confirmed.dotColor)}
                      />
                      {OCCUPIED_STATES.confirmed.label}
                    </li>
                  ) : null}
                  {legend.tentativeHold ? (
                    <li className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full",
                          OCCUPIED_STATES.tentative_hold.dotColor
                        )}
                      />
                      {OCCUPIED_STATES.tentative_hold.label}
                    </li>
                  ) : null}
                  {legend.blocked ? (
                    <li className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn("size-2 rounded-full", OCCUPIED_STATES.blocked.dotColor)}
                      />
                      {OCCUPIED_STATES.blocked.label}
                    </li>
                  ) : null}
                  {legend.bufferConflict ? (
                    <li className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full border border-coral"
                      />
                      Buffer conflict
                    </li>
                  ) : null}
                  {legend.closed ? (
                    <li className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="body-sm text-muted-foreground line-through"
                      >
                        31
                      </span>
                      Closed — no operating hours
                    </li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {schedule ? (
          <section
            aria-label="Availability results"
            className="min-w-0 split:col-start-1 split:row-start-2"
          >
            <Card>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
                  <div>
                    <h2 className="display-h2">{schedule.venue.name}</h2>
                    <p className="mt-2 body-sm text-muted-foreground">
                      {formatLocalDate(schedule.startDate)}
                      {schedule.endDate !== schedule.startDate &&
                        ` – ${formatLocalDate(schedule.endDate)}`}
                    </p>
                    <p className="mt-1 body-sm text-muted-foreground">
                      Times shown in venue local time
                    </p>
                  </div>
                  {canHold && (
                    <RequestVenueHoldDialog
                      key={`hold:${schedule.startDate}`}
                      venueId={schedule.venue.id}
                      venueName={schedule.venue.name}
                      defaultDate={schedule.startDate}
                      operatingHours={venueOperatingHours}
                      coordinatorEvents={coordinatorEvents}
                    />
                  )}
                  {canBlock && (
                    <RecordVenueBlockDialog
                      venueId={schedule.venue.id}
                      venueName={schedule.venue.name}
                      defaultDate={schedule.startDate}
                    />
                  )}
                </div>
                {requestedHolds.length > 0 && (
                  <div className="border-b border-border pb-5">
                    <h3 className="display-h3">Hold requests</h3>
                    <p className="mt-2 body-sm text-muted-foreground">{VENUE_HOLD_REQUEST_NOTE}</p>
                    <ul className="mt-3 divide-y divide-border">
                      {requestedHolds.map(hold => (
                        <li key={hold.id} className="flex flex-wrap items-center gap-4 py-3">
                          <DateChip day={timestampDay(hold.startsAt)} />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{VENUE_HOLD_REQUEST_LABEL}</p>
                            <p className="body-sm text-muted-foreground">
                              {timeRange({
                                visibleStart: hold.startsAt,
                                visibleEnd: hold.endsAt,
                              })}{" "}
                              · {schedule.venue.name}
                            </p>
                          </div>
                          {hold.canWithdraw && canHold && (
                            <WithdrawVenueHoldRequestButton holdId={hold.id} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {periods.length === 0 ? (
                  <p className="py-6 body-sm text-muted-foreground">
                    The venue has no opening hours in this range.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {periods.map(period => (
                      <li key={period.key} className="flex flex-wrap items-center gap-4 py-4">
                        <DateChip day={timestampDay(period.visibleStart)} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{period.label}</p>
                          <p className="body-sm text-muted-foreground">
                            {period.state === "closed" ? (
                              <>No operating hours · {schedule.venue.name}</>
                            ) : (
                              <>
                                {timeRange(period)} · {schedule.venue.name}
                              </>
                            )}
                          </p>
                          {period.state === "tentative_hold" && (
                            <div className="body-sm text-muted-foreground">
                              <p className="whitespace-nowrap">
                                {period.expiresAt
                                  ? `Expires ${formatLocalDateTime(period.expiresAt.slice(0, 16))}`
                                  : "No expiry set"}
                              </p>
                              {period.warnAt && (
                                <p className="whitespace-nowrap">
                                  Warning {formatLocalDateTime(period.warnAt.slice(0, 16))}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        {period.state === "closed" ? (
                          <Badge variant="outline">Closed</Badge>
                        ) : period.state !== "available" ? (
                          <Badge variant={OCCUPIED_STATES[period.state].variant}>
                            {OCCUPIED_STATES[period.state].label}
                          </Badge>
                        ) : null}
                        {period.bufferConflict && <Badge variant="outline">Buffer conflict</Badge>}
                        {period.state === "tentative_hold" &&
                          period.id &&
                          ((canHold && (period.canRelease || period.convertDefaults)) ||
                            (canSetExpiry && period.canChangeHold) ||
                            (period.canSetWarning && period.expiresAt)) && (
                            <div className="flex items-center gap-2">
                              {canHold && period.convertDefaults && (
                                <ConvertVenueHoldButton
                                  holdId={period.id}
                                  requirements={period.convertDefaults}
                                  layouts={layouts}
                                />
                              )}
                              {canHold && period.canRelease && (
                                <ReleaseVenueHoldButton holdId={period.id} />
                              )}
                              {canSetExpiry && period.canChangeHold && (
                                <SetVenueHoldExpiryButton
                                  holdId={period.id}
                                  expiresAt={period.expiresAt ?? null}
                                />
                              )}
                              {period.canSetWarning && (
                                <SetVenueHoldWarningButton
                                  holdId={period.id}
                                  warnAt={period.warnAt ?? null}
                                  expiresAt={period.expiresAt ?? null}
                                />
                              )}
                            </div>
                          )}
                        {period.state === "blocked" && period.id && canBlock && (
                          <LiftVenueBlockButton
                            blockId={period.id}
                            reason={period.label}
                            startsAt={period.startsAt}
                            endsAt={period.endsAt}
                            openEnded={period.openEnded}
                          />
                        )}
                        {period.state === "available" && canHold && (
                          <RequestVenueHoldDialog
                            key={`hold:${timestampDay(period.startsAt)}:${period.startsAt}`}
                            venueId={schedule.venue.id}
                            venueName={schedule.venue.name}
                            defaultDate={timestampDay(period.startsAt)}
                            defaultStartTime={timestampTime(period.startsAt).slice(0, 5)}
                            defaultEndTime={timestampTime(period.endsAt).slice(0, 5)}
                            operatingHours={venueOperatingHours}
                            coordinatorEvents={coordinatorEvents}
                            trigger={
                              <Button size="sm" variant="ghost">
                                Request this slot
                              </Button>
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        ) : (
          <p className="flex min-w-0 items-center gap-2 split:col-start-1 split:row-start-2 body-sm text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden="true" />
            Choose a venue and both dates to see its availability.
          </p>
        )}
      </div>
    </Page>
  );
}

/**
 * Show the month grid day cell. Mark a day that holds an occupied period with a dot, and name
 * the day state in text for assistive technology. A closed day has no dot, so it names itself
 * here. The day button itself mutes a closed day and outlines a buffer-conflict day from its
 * modifiers, so this cell only adds the dot and the state text. Read modifiers from the day
 * picker, so this cell needs nothing from the page. Keep it module-level. A component defined
 * during render becomes a new type on each pass, and React remounts it.
 */
function OccupiedDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  // The day map holds one state per day, so at most one modifier matches. Check blocked first.
  // Keep the previous precedence if the states ever change.
  const dotState = (["blocked", "tentative_hold", "confirmed"] as const).find(
    state => props.modifiers[state]
  );
  const dot = dotState ? OCCUPIED_STATES[dotState].dotColor : null;
  const stateText = [
    dotState ? OCCUPIED_STATES[dotState].label : null,
    props.modifiers.closed ? "Closed — no operating hours" : null,
    props.modifiers.bufferConflict ? "Buffer conflict" : null,
  ].filter(text => text !== null);
  return (
    <CalendarDayButton {...props}>
      {props.children}
      {dot ? <span aria-hidden="true" className={cn("mt-0.5 size-1.5 rounded-full", dot)} /> : null}
      {stateText.length > 0 ? <span className="sr-only">{stateText.join(", ")}</span> : null}
    </CalendarDayButton>
  );
}

/**
 * Use UTC for the civil date the picker and inputs use. Never use the venue product timezone.
 * Format every rendered value with `timeZone: "UTC"`.
 */
function civilDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function civilDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** Return the inclusive first and last civil day of the month that holds `date`. */
function monthRange(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    startDate: civilDay(new Date(Date.UTC(year, month, 1))),
    endDate: civilDay(new Date(Date.UTC(year, month + 1, 0))),
  };
}

/**
 * Show the visible part of a row as clock times. The date chip names the start day. Show a booking
 * past midnight as `23:00 - 24:00` when it ends at range end.
 */
function timeRange(period: Pick<CalendarRow, "visibleStart" | "visibleEnd" | "openEnded">) {
  const start = timestampTime(period.visibleStart).slice(0, 5);
  if (period.openEnded) return `${start} – until lifted`;
  const endClock = timestampTime(period.visibleEnd).slice(0, 5);
  const end =
    timestampEndDay(period.visibleEnd) === timestampDay(period.visibleStart)
      ? endClock
      : timestampTime(period.visibleEnd).startsWith("00:00:00")
        ? "24:00"
        : `${DAY_MONTH.format(civilDate(timestampDay(period.visibleEnd)))} ${endClock}`;
  return `${start} – ${end}`;
}

function DateChip({ day }: { day: string }) {
  return (
    <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted leading-none">
      <span className="eyebrow text-muted-foreground">{MONTH_SHORT.format(civilDate(day))}</span>
      <span className="mt-0.5 body-sm font-semibold">{Number(day.slice(8, 10))}</span>
    </span>
  );
}
