import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalendarRequestError,
  listCalendarVenues,
  readCalendar,
} from "#/features/venues/calendar-data";
import type { CalendarSelection } from "#/features/venues/calendar-data";
import type * as ServerFnsModule from "#/features/venues/server-fns";
import { createPtr28CalendarSource } from "../fixtures/ptr-28";

const serverFns = vi.hoisted(() => ({
  listVenues: vi.fn<() => Promise<unknown>>(),
  getVenueAvailability: vi.fn<(input: { data: CalendarSelection }) => Promise<unknown>>(),
}));
vi.mock("#/features/venues/server-fns", async importOriginal => ({
  ...(await importOriginal<typeof ServerFnsModule>()),
  ...serverFns,
}));

const selection = { venueId: "VA", startDate: "2026-10-05", endDate: "2026-10-07" };

afterEach(() => vi.clearAllMocks());

describe("PTR-28 server-function data boundary", () => {
  it("reuses listVenues and keeps only the calendar fields", async () => {
    serverFns.listVenues.mockResolvedValue([
      { id: 42, name: "Test Hall A", location: "not part of the calendar contract" },
    ]);

    await expect(listCalendarVenues()).resolves.toEqual([{ id: "42", name: "Test Hall A" }]);
    expect(serverFns.listVenues).toHaveBeenCalledOnce();
  });

  it("propagates a status response without fabricating empty data", async () => {
    serverFns.getVenueAvailability.mockResolvedValue(new Response("Unavailable", { status: 503 }));

    await expect(readCalendar(selection)).rejects.toEqual(new CalendarRequestError(503));
  });

  it.each(["wrong venue", "wrong dates", "invalid timezone", "invalid interval"])(
    "rejects a successful server-function result with %s",
    async variant => {
      const data = await createPtr28CalendarSource().read(selection);
      const changed =
        variant === "wrong venue"
          ? { ...data, venue: { id: "VB", name: "Test Hall B" } }
          : variant === "wrong dates"
            ? { ...data, startDate: "2026-10-12" }
            : variant === "invalid timezone"
              ? { ...data, timeZone: "Unknown/Zone" }
              : {
                  ...data,
                  available: [{ startsAt: "2026-10-05T12:00:00", endsAt: "2026-10-05T10:00:00" }],
                };
      serverFns.getVenueAvailability.mockResolvedValue(changed);

      await expect(readCalendar(selection)).rejects.toThrow("Invalid availability response");
    }
  );

  it("passes validated inclusive dates to the availability server function", async () => {
    const data = await createPtr28CalendarSource().read(selection);
    serverFns.getVenueAvailability.mockResolvedValue(data);

    await expect(readCalendar(selection)).resolves.toEqual(data);
    expect(serverFns.getVenueAvailability).toHaveBeenCalledWith({ data: selection });
  });

  it.each([
    { endDate: "2026-02-30", message: "Enter a valid end date" },
    { endDate: "2027-10-06", message: "Date range must be 366 days or fewer" },
  ])("rejects invalid or excessive civil-date ranges", async ({ endDate, message }) => {
    await expect(readCalendar({ ...selection, endDate })).rejects.toThrow(message);
    expect(serverFns.getVenueAvailability).not.toHaveBeenCalled();
  });
});
