/**
 * Calendar timestamp helpers. A floating timestamp is a venue-local wall-clock value and is
 * deliberately kept out of `Date`: parsing it as a JavaScript date would make the result depend
 * on the server or browser timezone.
 */

const FloatingTimestampShape =
  /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/;
const DatabaseTimestampShape =
  /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/;

const CivilDateShape = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCivilDate(value: string) {
  if (!CivilDateShape.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function formatCivilDate(date: Date) {
  const value = date.toISOString().slice(0, 10);
  if (!CivilDateShape.test(value)) throw new Error("Invalid calendar date");
  return value;
}

export function isCivilDate(value: string) {
  return parseCivilDate(value) !== null;
}

export function nextCivilDate(value: string) {
  const date = parseCivilDate(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + 1);
  return formatCivilDate(date);
}

export function previousCivilDate(value: string) {
  const date = parseCivilDate(value);
  if (!date) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() - 1);
  return formatCivilDate(date);
}

/** 0 = Sunday, matching JavaScript's `Date#getUTCDay` convention. */
export function weekdayForCivilDate(value: string) {
  const date = parseCivilDate(value);
  if (!date) throw new Error("Invalid calendar date");
  return date.getUTCDay();
}

export function isFloatingTimestamp(value: string) {
  const match = FloatingTimestampShape.exec(value);
  return match !== null && isCivilDate(match[1]);
}

export function normalizeDatabaseTimestamp(value: string) {
  const match = DatabaseTimestampShape.exec(value);
  const normalized = match ? `${match[1]}T${match[2]}` : "";
  if (!isFloatingTimestamp(normalized))
    throw new Error("Availability contains an invalid timestamp");
  return normalized;
}

function floatingKey(value: string) {
  const match = FloatingTimestampShape.exec(value);
  if (!match || !isCivilDate(match[1])) return null;
  const [clock, fraction = ""] = match[2].split(".");
  return `${match[1]}T${clock}.${fraction.padEnd(9, "0").slice(0, 9)}`;
}

export function compareTimestamps(left: string, right: string) {
  const leftKey = floatingKey(left);
  const rightKey = floatingKey(right);
  if (!leftKey || !rightKey) return Number.NaN;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function floatingDayOf(value: string) {
  const match = FloatingTimestampShape.exec(value);
  if (!match || !isCivilDate(match[1]))
    throw new Error("Availability contains an invalid timestamp");
  return match[1];
}

export function floatingEndDay(value: string) {
  const match = FloatingTimestampShape.exec(value);
  if (!match || !isCivilDate(match[1]))
    throw new Error("Availability contains an invalid timestamp");
  const [, clock] = match;
  const time = clock.slice(0, 8);
  return time === "00:00:00" ? previousCivilDate(match[1]) : match[1];
}

export function floatingTimeOf(value: string) {
  const match = FloatingTimestampShape.exec(value);
  if (!match || !isCivilDate(match[1]))
    throw new Error("Availability contains an invalid timestamp");
  return match[2];
}

export function floatingPeriodStart(date: string, time: string) {
  if (!isCivilDate(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("Availability contains an invalid opening period");
  return `${date}T${time}:00`;
}
