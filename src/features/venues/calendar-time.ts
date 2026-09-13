/**
 * Calendar timestamp helpers. A floating timestamp is a venue-local wall-clock value and is
 * deliberately kept out of `Date`: parsing it as a JavaScript date would make the result depend
 * on the server or browser timezone. Explicit-offset timestamps use instant comparison instead.
 */

export type CalendarTimeMode = "instant" | "floating";

const FloatingTimestampShape =
  /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/;
const DatabaseTimestampShape =
  /^(\d{4}-\d{2}-\d{2}) ((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)$/;

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function nextCivilDate(value: string) {
  if (!isCivilDate(value)) throw new Error("Invalid calendar date");
  let year = Number(value.slice(0, 4));
  let month = Number(value.slice(5, 7));
  let day = Number(value.slice(8, 10)) + 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function previousCivilDate(value: string) {
  if (!isCivilDate(value)) throw new Error("Invalid calendar date");
  let year = Number(value.slice(0, 4));
  let month = Number(value.slice(5, 7));
  let day = Number(value.slice(8, 10)) - 1;
  if (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day = daysInMonth(year, month);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 = Sunday, matching JavaScript's `Date#getUTCDay` convention. */
export function weekdayForCivilDate(value: string) {
  if (!isCivilDate(value)) throw new Error("Invalid calendar date");
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  let year = Number(value.slice(0, 4));
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (month < 3) year -= 1;
  return (
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      offsets[month - 1] +
      day) %
    7
  );
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

export function compareFloatingTimestamps(left: string, right: string) {
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
