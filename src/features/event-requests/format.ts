import { toLocalMinuteValue } from "#/features/venues/availability";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a stored `datetime-local` value, such as `2030-11-18T09:30`, as `18 Nov 2030, 09:30`.
 * Use string operations, not `Date`: this is the Organiser's wall-clock time, and `Date` would
 * shift it to the viewer's timezone. Return values in any other shape unchanged.
 */
export function formatLocalDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day, time] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS.length) return value;
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}, ${time}`;
}

/**
 * Format a stored date, such as `2030-11-18`, as `18 Nov 2030`. Use string operations for the same
 * reason as `formatLocalDateTime`. Return other values unchanged.
 */
export function formatLocalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS.length) return value;
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}`;
}

/** The first proposed window's start, which is what "proposed date" means on a one-line row. */
export function formatFirstProposedDate(windows: { start?: string }[]): string {
  const start = windows.find(window => window.start !== undefined)?.start;
  return start === undefined ? "—" : formatLocalDateTime(start);
}

/** One proposed window as a single line: `18 Nov 2030, 09:30 – 12:45`, or what is known of it. */
export function formatProposedWindow(window: { start?: string; end?: string }): string {
  if (window.start === undefined && window.end === undefined) return "Not yet chosen";
  const start = window.start === undefined ? "?" : formatLocalDateTime(window.start);
  if (window.end === undefined) return `${start} – ?`;
  const end =
    window.start !== undefined && window.end.slice(0, 10) === window.start.slice(0, 10)
      ? window.end.slice(11)
      : formatLocalDateTime(window.end);
  return `${start} – ${end}`;
}

/**
 * Format a venue-request entry's period, which covers one civil day, as a proposed window. The
 * entry holds a `YYYY-MM-DD` date and `HH:MM` times. Example: `5 Dec 2026, 17:00 – 21:00`.
 */
export function formatEntryPeriod(entry: {
  date: string;
  startTime: string;
  endTime: string;
}): string {
  return formatProposedWindow({
    start: `${entry.date}T${entry.startTime}`,
    end: `${entry.date}T${entry.endTime}`,
  });
}

/**
 * Format a server-recorded instant, such as a submission or assignment, in one fixed timezone.
 * The page renders on the server and then hydrates. Different timezones would change its text.
 * ConnectSphere's venues are in Singapore (brief §1), so use that timezone.
 */
export function formatInstant(value: Date | null): string {
  return value === null
    ? "an unknown date"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Singapore",
      }).format(value);
}

/**
 * Format a floating venue-local period, such as `2026-12-05 10:00:00`, as a proposed window.
 * Bookings and holds use the `mode: "string"` shape. Example: `5 Dec 2026, 10:00 – 16:00`.
 */
export function formatVenuePeriod(startsAt: string, endsAt: string): string {
  return formatProposedWindow({
    start: toLocalMinuteValue(startsAt),
    end: toLocalMinuteValue(endsAt),
  });
}
