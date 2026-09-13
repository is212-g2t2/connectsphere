import { projectAvailability } from "#/routes/api/venue-availability";
import type { CalendarSelection } from "#/features/venues/calendar-data";

/** PTR28_BASE v1. UTC+08:00 and all-day opening are test conventions only. */
export const PTR28_CLOCK = "2026-10-01T09:00:00+08:00";
export const PTR28_TIME_ZONE = "Asia/Singapore";

export function fixtureTime(day: number, time: string): string {
  return `2026-10-${String(day).padStart(2, "0")}T${time}:00+08:00`;
}

/** Test-only adapter. Never imported by application code or used as a live data fallback. */
export function createPtr28CalendarSource(fixture = createPtr28Fixture()) {
  return {
    async listVenues() {
      return fixture.venues.map(({ id, name }) => ({ id, name }));
    },
    async read(selection: CalendarSelection) {
      const venue = fixture.venues.find(item => item.id === selection.venueId);
      if (!venue) throw new Error("Venue not found");
      const nextDate = new Date(`${selection.endDate}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const range = {
        startsAt: `${selection.startDate}T00:00:00+08:00`,
        endsAt: `${nextDate.toISOString().slice(0, 10)}T00:00:00+08:00`,
      };
      return {
        venue: { id: venue.id, name: venue.name },
        startDate: selection.startDate,
        endDate: selection.endDate,
        timeZone: PTR28_TIME_ZONE,
        ...projectAvailability(
          { venueId: venue.id, ...range },
          {
            bookings: fixture.bookings,
            blocks: fixture.blocks,
            openPeriods: [range],
            pendingTreatment: "no-hold",
          }
        ),
      };
    },
  };
}

export function createPtr28Fixture() {
  const period = (day: number, start: string, end: string, endDay = day) => ({
    startsAt: fixtureTime(day, start),
    endsAt: fixtureTime(endDay, end),
  });
  return {
    accounts: [
      { id: "COORD-A", email: "coordinator-a@example.test", role: "event_coordinator" },
      { id: "COORD-B", email: "coordinator-b@example.test", role: "event_coordinator" },
      { id: "STAFF-A", email: "venue-staff-a@example.test", role: "venue_staff" },
      { id: "ATTENDEE-A", email: "attendee-a@example.test", role: "attendee" },
      { id: "ORGANISER-A", email: "organiser-a@example.test", role: "event_organiser" },
    ],
    venues: [
      { id: "VA", name: "Test Hall A", location: "Test Building A", capacity: 100 },
      { id: "VB", name: "Test Hall B", location: "Test Building B", capacity: 50 },
    ],
    events: [
      { id: "E01", coordinatorId: "COORD-A" },
      { id: "E02", coordinatorId: "COORD-B" },
      { id: "E03", coordinatorId: "COORD-B" },
      { id: "E04", coordinatorId: "COORD-B" },
      { id: "E05", coordinatorId: "COORD-A" },
      { id: "E06", coordinatorId: "COORD-A" },
    ],
    bookings: [
      {
        id: "B01",
        venueId: "VA",
        eventId: "E01",
        status: "approved" as const,
        ...period(5, "10:00", "12:00"),
      },
      {
        id: "B02",
        venueId: "VA",
        eventId: "E02",
        status: "approved" as const,
        ...period(6, "14:00", "16:00"),
      },
      {
        id: "B03",
        venueId: "VA",
        eventId: "E03",
        status: "approved" as const,
        ...period(6, "23:00", "01:00", 7),
      },
      {
        id: "B04",
        venueId: "VB",
        eventId: "E04",
        status: "approved" as const,
        ...period(5, "09:00", "10:00"),
      },
      {
        id: "B05",
        venueId: "VA",
        eventId: "E05",
        status: "approved" as const,
        ...period(12, "10:00", "12:00"),
      },
      {
        id: "P01",
        venueId: "VA",
        eventId: "E06",
        status: "pending" as const,
        ...period(5, "16:00", "17:00"),
      },
    ],
    blocks: [
      { id: "U01", venueId: "VA", reason: "Maintenance", ...period(5, "13:00", "15:00") },
      { id: "U02", venueId: "VA", reason: "Operational closure", ...period(7, "09:00", "11:00") },
      { id: "U03", venueId: "VB", reason: "Maintenance", ...period(5, "11:00", "12:00") },
      { id: "U04", venueId: "VA", reason: "Maintenance", ...period(12, "13:00", "15:00") },
    ],
    ranges: {
      R1: period(5, "00:00", "00:00", 8),
      R2: period(12, "00:00", "00:00", 13),
      R3: period(5, "00:00", "00:00", 6),
    },
  };
}
