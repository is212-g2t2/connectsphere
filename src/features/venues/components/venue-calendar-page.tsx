import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Calendar, CalendarDayButton } from "#/components/ui/calendar";
import { Card, CardContent } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  compareTimestamps,
  timestampDay,
  timestampEndDay,
  timestampTime,
} from "#/features/venues/availability";
import { AvailabilitySelectionSchema } from "#/features/venues/schema";
import type { AvailabilitySearch } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";
import { cn, NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * The venue calendar (PTR-28): a venue and an inclusive date range in, its free, confirmed and
 * blocked periods out. The rows and the calendar come from the route loader and the applied search
 * from the route, both as props, so the page renders in a unit test without a router (PTR-75).
 * Selecting a range navigates to the same route with new search parameters, which is what re-runs
 * the loader — there is no separate fetch state to keep in step.
 */
export function VenueCalendarPage({
  venues,
  schedule,
  search,
}: {
  venues: Venue[];
  schedule: VenueAvailability | null;
  search: AvailabilitySearch;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState({
    venueId: search.venueId === undefined ? "" : String(search.venueId),
    startDate: search.startDate ?? "",
    endDate: search.endDate ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() =>
    search.startDate ? civilDate(search.startDate) : new Date()
  );

  const selected = {
    from: draft.startDate ? civilDate(draft.startDate) : undefined,
    to:
      draft.endDate && draft.startDate && draft.endDate >= draft.startDate
        ? civilDate(draft.endDate)
        : undefined,
  };

  const occupiedDays = new Map<string, "confirmed" | "blocked">();
  for (const period of schedule?.occupied ?? []) {
    for (
      let day = timestampDay(period.visibleStart);
      day <= timestampEndDay(period.visibleEnd);
      day = nextDay(day)
    ) {
      if (!occupiedDays.has(day)) occupiedDays.set(day, period.state);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = AvailabilitySelectionSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    void navigate({ to: "/venues/availability", search: parsed.data });
  }

  const periods = schedule
    ? [
        ...schedule.available.map(period => ({
          key: `available:${period.startsAt}`,
          label: "Available",
          state: "available" as const,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
        })),
        ...schedule.occupied.map(period => ({
          key: `${period.state}:${period.id}`,
          label: period.label,
          state: period.state,
          startsAt: period.visibleStart,
          endsAt: period.visibleEnd,
        })),
      ].toSorted((left, right) => compareTimestamps(left.startsAt, right.startsAt))
    : [];

  return (
    <Page
      width="wide"
      sidebar={
        <aside aria-label="Calendar view">
          <Card>
            <CardContent>
              <Calendar
                mode="range"
                timeZone="UTC"
                selected={selected}
                month={month}
                onMonthChange={setMonth}
                modifiers={{
                  blocked: [...occupiedDays]
                    .filter(([, state]) => state === "blocked")
                    .map(([day]) => civilDate(day)),
                  confirmed: [...occupiedDays]
                    .filter(([, state]) => state === "confirmed")
                    .map(([day]) => civilDate(day)),
                }}
                onSelect={range =>
                  setDraft(current => ({
                    ...current,
                    startDate: range?.from ? civilDay(range.from) : "",
                    endDate: range?.to ? civilDay(range.to) : "",
                  }))
                }
                components={{ DayButton: OccupiedDayButton }}
              />
              <ul
                aria-label="Availability legend"
                className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 body-sm text-muted-foreground"
              >
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full border border-border" />
                  Available
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full bg-harbor" />
                  Confirmed booking
                </li>
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full bg-coral" />
                  Unavailable / blocked
                </li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      }
    >
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        eyebrow="Venues"
        title="Venue calendar"
        description="Pick a venue and a date range to see when it can be requested — its free periods, confirmed bookings and recorded unavailability."
      />

      <section aria-label="Availability filters">
        <Card>
          <CardContent>
            {venues.length === 0 ? (
              <p className="body-sm text-muted-foreground">No venues recorded yet.</p>
            ) : (
              <form className="space-y-5" noValidate onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="availability-venue">Venue</Label>
                  <Select
                    value={draft.venueId === "" ? null : draft.venueId}
                    onValueChange={value => setDraft({ ...draft, venueId: value ?? "" })}
                    required
                  >
                    <SelectTrigger id="availability-venue" className="w-full">
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
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="availability-start">Start date</Label>
                    <Input
                      id="availability-start"
                      type="date"
                      value={draft.startDate}
                      onChange={event => setDraft({ ...draft, startDate: event.target.value })}
                      required
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="availability-end">End date</Label>
                    <Input
                      id="availability-end"
                      type="date"
                      value={draft.endDate}
                      onChange={event => setDraft({ ...draft, endDate: event.target.value })}
                      required
                    />
                  </div>
                </div>
                {error && (
                  <p role="alert" className="body-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full sm:w-auto">
                  Show availability
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      {schedule ? (
        <section aria-label="Availability results" className="mt-8">
          <Card>
            <CardContent>
              <div className="border-b border-border pb-5">
                <h2 className="display-h2">{schedule.venue.name}</h2>
                <p className="mt-2 body-sm text-muted-foreground">
                  {dateLabel(schedule.startDate)}
                  {schedule.endDate !== schedule.startDate && ` – ${dateLabel(schedule.endDate)}`}
                </p>
                <p className="mt-1 body-sm text-muted-foreground">
                  Times shown in venue local time
                </p>
              </div>
              {periods.length === 0 ? (
                <p className="py-6 body-sm text-muted-foreground">
                  The venue has no opening hours in this range.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {periods.map(period => (
                    <li key={period.key} className="flex flex-wrap items-center gap-4 py-4">
                      <DateChip day={timestampDay(period.startsAt)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{period.label}</p>
                        <p className="body-sm text-muted-foreground">
                          {timeRange(period)} · {schedule.venue.name}
                        </p>
                      </div>
                      {period.state !== "available" && (
                        <Badge variant={period.state === "blocked" ? "stopped" : "confirmed"}>
                          {period.state === "blocked"
                            ? "Unavailable / blocked"
                            : "Confirmed booking"}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      ) : (
        <p className="mt-8 flex items-center gap-2 body-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden="true" />
          Choose a venue and both dates to see its availability.
        </p>
      )}
    </Page>
  );
}

/**
 * The month grid's day cell, with a dot under a day that holds an occupied period. The modifiers
 * come from the day picker itself, so this needs nothing from the page and stays module-level —
 * a component defined during render is a new type on every pass, which React remounts.
 */
function OccupiedDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  const dot = props.modifiers.blocked ? "bg-coral" : props.modifiers.confirmed ? "bg-harbor" : null;
  return (
    <CalendarDayButton {...props}>
      {props.children}
      {dot ? <span aria-hidden="true" className={cn("mt-0.5 size-1.5 rounded-full", dot)} /> : null}
    </CalendarDayButton>
  );
}

/**
 * UTC here represents the civil date the picker and the inputs speak, never the venue's product
 * timezone: every value rendered from it is formatted with `timeZone: "UTC"` for the same reason.
 */
function civilDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function civilDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function nextDay(value: string) {
  const date = civilDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return civilDay(date);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(civilDate(value));
}

/** A booking that continues past midnight reads as `23:00 – 24:00` when it ends at range end. */
function timeRange(period: { startsAt: string; endsAt: string }) {
  const start = timestampTime(period.startsAt).slice(0, 5);
  const endClock = timestampTime(period.endsAt).slice(0, 5);
  const end =
    timestampEndDay(period.endsAt) === timestampDay(period.startsAt)
      ? endClock
      : timestampTime(period.endsAt).startsWith("00:00:00")
        ? "24:00"
        : `${new Intl.DateTimeFormat("en-GB", {
            timeZone: "UTC",
            day: "numeric",
            month: "short",
          }).format(civilDate(timestampDay(period.endsAt)))} ${endClock}`;
  return `${start} – ${end}`;
}

function DateChip({ day }: { day: string }) {
  return (
    <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted leading-none">
      <span className="eyebrow text-muted-foreground">
        {new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" }).format(
          civilDate(day)
        )}
      </span>
      <span className="mt-0.5 body-sm font-semibold">{Number(day.slice(8, 10))}</span>
    </span>
  );
}
