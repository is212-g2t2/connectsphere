/** `2026-10-12 14:30:00` → `12 October 2026`; UTC so the civil date cannot shift with the reader. */
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`)
  );
}

/** `2026-10-12 14:30:00` → `14:30`. */
export function formatTime(value: string) {
  return value.slice(11, 16);
}

/** `2026-10-12 14:30:00` to `17:00:00` → `12 October 2026, 14:30–17:00`. Name both days when it crosses one. */
export function formatPeriod(startsAt: string, endsAt: string) {
  return startsAt.slice(0, 10) === endsAt.slice(0, 10)
    ? `${formatDate(startsAt)}, ${formatTime(startsAt)}–${formatTime(endsAt)}`
    : `${formatDate(startsAt)}, ${formatTime(startsAt)} – ${formatDate(endsAt)}, ${formatTime(endsAt)}`;
}
