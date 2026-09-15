const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A stored `datetime-local` value (`2030-11-18T09:30`) as a reader sees it: `18 Nov 2030, 09:30`.
 * String arithmetic rather than a `Date`, for the reason the value is stored as text at all —
 * it is the organiser's wall-clock, and building a `Date` would shift it by the viewer's zone.
 * Anything not in that shape is returned untouched rather than mis-rendered.
 */
export function formatLocalDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day, time] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS.length) return value;
  return `${Number(day)} ${MONTHS[monthIndex]} ${year}, ${time}`;
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
 * An instant the server recorded — a submission or an assignment — unlike the wall-clock strings
 * above. Rendered in one fixed zone rather than the runtime's: the page is server-rendered and
 * then hydrated, and a zone that differed between the two would change the text under React's
 * feet. ConnectSphere's venues are in Singapore (brief §1), so that is the zone.
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
