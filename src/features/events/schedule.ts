import type { EventVenue } from "#/features/events/access";

interface EventScheduleInput {
  eventDate: string | null;
  endDate?: string | null;
  startTime: string | null;
  endTime: string | null;
  venue?: EventVenue | null;
}

/** Whether `end` is the calendar day after `start` (`YYYY-MM-DD`), parsed as UTC so the
 * server render and the hydrated client agree. Anything not in that shape is not next-day. */
function isNextDay(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.exec(start) || !/^\d{4}-\d{2}-\d{2}$/.exec(end)) return false;
  const next = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return false;
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10) === end;
}

/** An event's date and time: the current approved booking first, then the original proposal. */
export function eventSchedule(details: EventScheduleInput) {
  const date = details.venue?.date ?? details.eventDate;
  const endDate = details.venue?.endDate ?? details.endDate;
  const startTime = details.venue?.startTime ?? details.startTime;
  const endTime = details.venue?.endTime ?? details.endTime;

  return {
    date,
    endDate,
    startTime,
    endTime,
    spansDays: Boolean(date && endDate && endDate !== date),
    crossesMidnight: Boolean(details.venue && isNextDay(details.venue.date, details.venue.endDate)),
  };
}
