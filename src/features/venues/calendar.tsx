import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, RefreshCw } from "lucide-react";

import { Calendar } from "#/components/ui/calendar";
import { Button } from "#/components/ui/button";
import { Badge } from "#/components/ui/badge";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select";
import {
  CalendarRequestError,
  calendarSource,
  parseCalendarSelection,
} from "#/features/venues/calendar-data";
import {
  compareFloatingTimestamps,
  floatingDayOf,
  floatingEndDay,
  floatingTimeOf,
} from "#/features/venues/calendar-time";
import type {
  CalendarSchedule,
  CalendarSelection,
  CalendarSource,
} from "#/features/venues/calendar-data";

// UTC here represents civil-date controls, never the venue's product timezone or operating day.
function civilDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
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
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(civilDate(value).getTime());
}

export function AvailabilityCalendar({ source = calendarSource }: { source?: CalendarSource }) {
  const [filters, setFilters] = useState<CalendarSelection>({
    venueId: "",
    startDate: "",
    endDate: "",
  });
  const [applied, setApplied] = useState<CalendarSelection | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [month, setMonth] = useState<Date>();
  const venues = useQuery({
    queryKey: ["venue-availability", "venues"],
    queryFn: ({ signal }) => source.listVenues(signal),
    retry: false,
  });
  const schedule = useQuery({
    queryKey: ["venue-availability", "schedule", applied],
    queryFn: ({ signal }) => {
      if (!applied) throw new Error("Choose a venue and dates first");
      return source.read(applied, signal);
    },
    enabled: applied !== null && venues.isSuccess,
    retry: false,
  });

  function update(next: CalendarSelection) {
    setFilters(next);
    setApplied(null);
    setValidation(null);
    if (validDate(next.startDate)) setMonth(civilDate(next.startDate));
  }

  const selected = validDate(filters.startDate)
    ? {
        from: civilDate(filters.startDate),
        to:
          validDate(filters.endDate) && filters.endDate >= filters.startDate
            ? civilDate(filters.endDate)
            : undefined,
      }
    : undefined;

  return (
    <div className="mt-8 grid items-start gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <section
        className="rounded-xl border border-border bg-card p-6"
        aria-label="Availability filters"
      >
        <h2 className="text-lg font-semibold">Choose a venue and dates</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Select both dates to include the full range.
        </p>
        {venues.isPending || venues.isFetching ? (
          <output className="mt-6 block text-sm text-muted-foreground">Loading venues…</output>
        ) : venues.isError ? (
          <RequestFailure
            error={venues.error}
            subject="venues"
            retry={() => void venues.refetch()}
          />
        ) : venues.data.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">No venues available to view yet.</p>
        ) : (
          <form
            className="mt-6 space-y-5"
            noValidate
            onSubmit={event => {
              event.preventDefault();
              try {
                const selection = parseCalendarSelection(filters);
                if (!venues.data.some(venue => venue.id === selection.venueId))
                  throw new Error("Select a venue from the list");
                setValidation(null);
                setApplied(selection);
              } catch (error) {
                setValidation(error instanceof Error ? error.message : "Check the venue and dates");
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="availability-venue">Venue</Label>
              <NativeSelect
                id="availability-venue"
                className="w-full"
                value={filters.venueId}
                onChange={event => update({ ...filters, venueId: event.target.value })}
                required
              >
                <NativeSelectOption value="">Select a venue</NativeSelectOption>
                {venues.data.map(venue => (
                  <NativeSelectOption key={venue.id} value={venue.id}>
                    {venue.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="availability-start">Start date</Label>
                <Input
                  id="availability-start"
                  type="date"
                  value={filters.startDate}
                  onChange={event => update({ ...filters, startDate: event.target.value })}
                  required
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="availability-end">End date</Label>
                <Input
                  id="availability-end"
                  type="date"
                  value={filters.endDate}
                  onChange={event => update({ ...filters, endDate: event.target.value })}
                  required
                />
              </div>
            </div>
            <Calendar
              className="mx-auto p-0"
              mode="range"
              timeZone="UTC"
              selected={selected}
              month={month}
              onMonthChange={setMonth}
              onSelect={range =>
                update({
                  ...filters,
                  startDate: range?.from?.toISOString().slice(0, 10) ?? "",
                  endDate: range?.to?.toISOString().slice(0, 10) ?? "",
                })
              }
            />
            {validation && (
              <p role="alert" className="text-sm text-destructive">
                {validation}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={schedule.isFetching}>
              Show availability
            </Button>
          </form>
        )}
      </section>

      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap items-center gap-3" aria-label="Availability legend">
          <Badge variant="outline">Available</Badge>
          <Badge variant="confirmed">Confirmed booking</Badge>
          <Badge variant="stopped">Unavailable / blocked</Badge>
        </div>
        {applied && schedule.isFetching ? (
          <output className="block py-12 text-sm text-muted-foreground">
            Loading availability…
          </output>
        ) : applied && schedule.isError ? (
          <RequestFailure
            error={schedule.error}
            subject="availability"
            retry={() => void schedule.refetch()}
          />
        ) : applied && venues.isSuccess && !venues.isFetching && schedule.data ? (
          <Schedule
            key={`${applied.venueId}:${applied.startDate}:${applied.endDate}`}
            data={schedule.data}
          />
        ) : (
          <div className="border-t border-border py-12">
            <CalendarDays className="mb-4 size-6 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Find a time for your event</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Choose a venue and date range to see its available, confirmed and blocked periods.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RequestFailure({
  error,
  subject,
  retry,
}: {
  error: Error;
  subject: "venues" | "availability";
  retry: () => void;
}) {
  const status = error instanceof CalendarRequestError ? error.status : undefined;
  return (
    <div className="mt-6 space-y-4">
      <p role="alert" className="text-sm text-destructive">
        {status === 401
          ? "Your session has ended. Sign in again to continue."
          : status === 403
            ? "You do not have access to venue availability."
            : subject === "venues"
              ? "Venues could not be loaded. Please try again."
              : "Availability could not be loaded. Please try again."}
      </p>
      {status === 401 ? (
        <a href="/login" className="text-sm underline underline-offset-4">
          Sign in
        </a>
      ) : status === 403 ? (
        <a href="/dashboard" className="text-sm underline underline-offset-4">
          Back to dashboard
        </a>
      ) : (
        <Button variant="outline" onClick={retry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry {subject}
        </Button>
      )}
    </div>
  );
}

function Schedule({ data }: { data: CalendarSchedule }) {
  const [page, setPage] = useState(0);
  const floating = data.timeZone === null;
  const dayMilliseconds = 86_400_000;
  const start = civilDate(data.startDate).getTime();
  const end = civilDate(data.endDate).getTime();
  const days: string[] = [];
  for (
    let instant = start + page * 7 * dayMilliseconds;
    instant <= end && days.length < 7;
    instant += dayMilliseconds
  )
    days.push(new Date(instant).toISOString().slice(0, 10));
  const dateParts = new Intl.DateTimeFormat("en", {
    timeZone: data.timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  function formatTime(instant: string, includeDate = false) {
    if (floating) {
      const day = floatingDayOf(instant);
      const clock = floatingTimeOf(instant);
      const [hour, minute, seconds = "00"] = clock.split(":");
      const hourMinute = `${hour}:${minute}`;
      const separator = seconds.indexOf(".");
      const second = separator < 0 ? seconds : seconds.slice(0, separator);
      const fraction = separator < 0 ? "" : seconds.slice(separator + 1);
      const hasFraction = fraction.length > 0 && !/^0+$/.test(fraction);
      const time =
        second !== "00" || hasFraction
          ? `${hourMinute}:${second}${hasFraction ? `.${fraction}` : ""}`
          : hourMinute;
      if (!includeDate) return time;
      const formattedDate = new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "2-digit",
      }).format(civilDate(day));
      return `${formattedDate}, ${time}`;
    }
    const date = new Date(instant);
    const milliseconds = date.getUTCMilliseconds() !== 0;
    const seconds = date.getUTCSeconds() !== 0 || milliseconds;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: data.timeZone ?? "UTC",
      year: includeDate ? "numeric" : undefined,
      month: includeDate ? "short" : undefined,
      day: includeDate ? "2-digit" : undefined,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      second: seconds ? "2-digit" : undefined,
      fractionalSecondDigits: milliseconds ? 3 : undefined,
    }).format(date);
  }
  function dayOf(instant: string | number) {
    if (floating) {
      if (typeof instant !== "string") throw new Error("Invalid floating calendar timestamp");
      return floatingDayOf(instant);
    }
    const parts = dateParts.formatToParts(new Date(instant));
    return ["year", "month", "day"]
      .map(type => parts.find(part => part.type === type)?.value)
      .join("-");
  }
  function endDay(instant: string) {
    return floating ? floatingEndDay(instant) : dayOf(Date.parse(instant) - 1);
  }
  const periods = [
    ...data.available.map(period => ({
      ...period,
      visibleStart: period.startsAt,
      visibleEnd: period.endsAt,
      state: "available" as const,
      key: `available:${period.startsAt}`,
    })),
    ...data.occupied.map(period => ({ ...period, key: `${period.state}:${period.id}` })),
  ].toSorted((a, b) =>
    floating
      ? compareFloatingTimestamps(a.visibleStart, b.visibleStart)
      : Date.parse(a.visibleStart) - Date.parse(b.visibleStart)
  );

  return (
    <section aria-label="Availability results">
      <div className="border-b border-border pb-5">
        <h2 className="text-2xl font-semibold">{data.venue.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {dateLabel(data.startDate)}
          {data.endDate !== data.startDate && ` – ${dateLabel(data.endDate)}`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.timeZone === null
            ? "Times shown in venue local time"
            : `Times shown in ${data.timeZone}`}
        </p>
      </div>
      {days.map(day => {
        const visible = periods.filter(
          period => dayOf(period.visibleStart) <= day && endDay(period.visibleEnd) >= day
        );
        return (
          <section key={day} aria-label={dateLabel(day)} className="border-b border-border py-6">
            <h3 className="mb-4 text-base font-semibold">{dateLabel(day)}</h3>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No availability periods were returned for this date.
              </p>
            ) : (
              <ul className="space-y-3">
                {visible.map(period => {
                  const first =
                    dayOf(period.visibleStart) < day ? "00:00" : formatTime(period.visibleStart);
                  const last =
                    dayOf(period.visibleEnd) > day ? "24:00" : formatTime(period.visibleEnd);
                  const extended =
                    dayOf(period.startsAt) !== endDay(period.endsAt) ||
                    period.startsAt !== period.visibleStart ||
                    period.endsAt !== period.visibleEnd;
                  return (
                    <li key={period.key} className="rounded-lg bg-muted/40 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm font-medium tabular-nums">
                          {first}–{last}
                        </span>
                        <Badge
                          variant={
                            period.state === "confirmed"
                              ? "confirmed"
                              : period.state === "blocked"
                                ? "stopped"
                                : "outline"
                          }
                        >
                          {period.state === "confirmed"
                            ? "Confirmed booking"
                            : period.state === "blocked"
                              ? "Unavailable / blocked"
                              : "Available"}
                        </Badge>
                      </div>
                      {period.state !== "available" && extended && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Full period: {formatTime(period.startsAt, true)} –{" "}
                          {formatTime(period.endsAt, true)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      {(end - start) / dayMilliseconds >= 7 && (
        <nav
          aria-label="Availability days"
          className="mt-6 flex items-center justify-between gap-4"
        >
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(value => value - 1)}
          >
            Previous days
          </Button>
          <Button
            variant="outline"
            disabled={start + (page + 1) * 7 * dayMilliseconds > end}
            onClick={() => setPage(value => value + 1)}
          >
            Next days
          </Button>
        </nav>
      )}
    </section>
  );
}
