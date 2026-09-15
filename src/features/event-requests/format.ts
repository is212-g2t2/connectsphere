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
