import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvailabilityCalendar } from "#/features/venues/calendar";
import type { CalendarSchedule, CalendarSource } from "#/features/venues/calendar-data";
import { createPtr28CalendarSource, createPtr28Fixture, fixtureTime } from "../fixtures/ptr-28";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function setup(source: CalendarSource = createPtr28CalendarSource()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <AvailabilityCalendar source={source} />
    </QueryClientProvider>
  );
  return userEvent.setup();
}

async function selectRange(startDate = "2026-10-05", endDate = "2026-10-07", venue = "VA") {
  await screen.findByRole("option", { name: "Test Hall A" });
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: venue } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: startDate } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: endDate } });
  fireEvent.click(screen.getByRole("button", { name: "Show availability" }));
}

describe("PTR-28 calendar component with isolated fixtures", () => {
  it("[PTR-28-TC04][AC1] lets the shared Calendar set the selected dates", async () => {
    const user = setup();
    await screen.findByRole("option", { name: "Test Hall A" });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /Monday, October 12th, 2026/ }));
    await user.click(screen.getByRole("button", { name: /Wednesday, October 14th, 2026/ }));
    expect(screen.getByLabelText<HTMLInputElement>("Start date").value).toBe("2026-10-12");
    expect(screen.getByLabelText<HTMLInputElement>("End date").value).toBe("2026-10-14");
  });

  it("[PTR-28-TC04][AC1] makes every date in a longer range reachable", async () => {
    const user = setup();
    await selectRange("2026-10-05", "2026-10-12");
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(7);
    await user.click(screen.getByRole("button", { name: "Next days" }));
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(within(results).getByRole("heading", { name: "Monday, 12 October 2026" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous days" }));
    expect(within(results).getByRole("heading", { name: "Monday, 5 October 2026" })).toBeTruthy();
  });

  it("[PTR-28-TC01][AC1] requests venue and inclusive calendar dates without a machine-timezone conversion", async () => {
    const source = createPtr28CalendarSource();
    const read = vi.fn<CalendarSource["read"]>(selection => source.read(selection));
    setup({ ...source, read });
    await selectRange();
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getByRole("heading", { name: "Test Hall A" })).toBeTruthy();
    expect(read).toHaveBeenCalledWith(
      { venueId: "VA", startDate: "2026-10-05", endDate: "2026-10-07" },
      expect.any(AbortSignal)
    );
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("[PTR-28-TC03][AC1] clears previous venue results when selection changes", async () => {
    const user = setup();
    await selectRange();
    await screen.findByRole("region", { name: "Availability results" });
    await user.selectOptions(screen.getByLabelText("Venue"), "VB");
    expect(screen.queryByRole("region", { name: "Availability results" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show availability" }));
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getByRole("heading", { name: "Test Hall B" })).toBeTruthy();
    expect(within(results).getByText("09:00–10:00")).toBeTruthy();
    expect(within(results).queryByText("13:00–15:00")).toBeNull();
  });

  it("[PTR-28-TC04][AC1] replaces the displayed date range", async () => {
    setup();
    await selectRange();
    await screen.findByRole("region", { name: "Availability results" });
    await selectRange("2026-10-12", "2026-10-12");
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(within(results).getByRole("heading", { name: "Monday, 12 October 2026" })).toBeTruthy();
  });

  it("[PTR-28-TC05][AC2][PTR-28-TC11][AC4] labels available, confirmed and blocked periods in the results", async () => {
    setup();
    await selectRange("2026-10-05", "2026-10-05");
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getAllByText("Available").length).toBeGreaterThan(0);
    expect(within(results).getByText("Confirmed booking")).toBeTruthy();
    expect(within(results).getByText("Unavailable / blocked")).toBeTruthy();
    expect(within(results).getByText("10:00–12:00")).toBeTruthy();
    expect(within(results).getByText("13:00–15:00")).toBeTruthy();
  });

  it("[PTR-28-TC06][AC3] displays the exact 10:15–11:45 fixture override", async () => {
    const fixture = createPtr28Fixture();
    fixture.bookings[0].startsAt = fixtureTime(5, "10:15");
    fixture.bookings[0].endsAt = fixtureTime(5, "11:45");
    setup(createPtr28CalendarSource(fixture));
    await selectRange("2026-10-05", "2026-10-05");
    expect(await screen.findByText("10:15–11:45")).toBeTruthy();
    expect(screen.queryByText("10:00–12:00")).toBeNull();
  });

  it("[PTR-28-TC08][AC3] splits overnight display across both days and retains the full period", async () => {
    setup();
    await selectRange();
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getByText("23:00–24:00")).toBeTruthy();
    expect(within(results).getByText("00:00–01:00")).toBeTruthy();
    expect(
      within(results).getAllByText(/Full period: 06 Oct 2026, 23:00.*07 Oct 2026, 01:00/)
    ).toHaveLength(2);
    expect(within(results).getByText("Times shown in Asia/Singapore")).toBeTruthy();
  });

  it("[PTR-28-TC06][AC3] does not round away seconds or milliseconds", async () => {
    const fixture = createPtr28Fixture();
    fixture.bookings[0].startsAt = "2026-10-05T10:15:30.125+08:00";
    fixture.bookings[0].endsAt = "2026-10-05T11:45:42.750+08:00";
    setup(createPtr28CalendarSource(fixture));
    await selectRange("2026-10-05", "2026-10-05");
    expect(await screen.findByText("10:15:30.125–11:45:42.750")).toBeTruthy();
  });

  it("renders floating venue-local seconds and fractions without machine-timezone conversion", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const localSchedule: CalendarSchedule = {
      venue: { id: "VA", name: "Local Hall" },
      startDate: "2026-10-05",
      endDate: "2026-10-05",
      timeZone: null,
      available: [
        {
          startsAt: "2026-10-05T10:15:30.125",
          endsAt: "2026-10-05T11:45:42.750",
        },
        {
          startsAt: "2026-10-05T12:00:00.000",
          endsAt: "2026-10-05T13:00:00.000",
        },
      ],
      occupied: [],
    };
    setup({
      listVenues: async () => [{ id: "VA", name: "Test Hall A" }],
      read: async () => localSchedule,
    });
    await selectRange("2026-10-05", "2026-10-05");
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getByText("10:15:30.125–11:45:42.750")).toBeTruthy();
    expect(within(results).getByText("12:00–13:00")).toBeTruthy();
    expect(within(results).queryByText("12:00:00.000–13:00:00.000")).toBeNull();
    expect(within(results).getByText("Times shown in venue local time")).toBeTruthy();
  });

  it.each([
    { variant: "A", venue: "", start: "2026-10-05", end: "2026-10-07", message: "Select a venue" },
    {
      variant: "D",
      venue: "VA",
      start: "2026-10-07",
      end: "2026-10-05",
      message: "End date must be on or after start date",
    },
    { variant: "E", venue: "VA", start: "2026-10-05", end: "", message: "Enter a valid end date" },
  ])(
    "[PTR-28-TC15-$variant][AC1] validates filters before querying",
    async ({ venue, start, end, message }) => {
      const source = createPtr28CalendarSource();
      const read = vi.fn<CalendarSource["read"]>(selection => source.read(selection));
      setup({ ...source, read });
      await selectRange(start, end, venue);
      expect((await screen.findByRole("alert")).textContent).toContain(message);
      expect(read).not.toHaveBeenCalled();
    }
  );

  it("[PTR-28-TC16][AC2] distinguishes a successful free day from missing venues", async () => {
    const fixture = createPtr28Fixture();
    fixture.bookings = [];
    fixture.blocks = [];
    setup(createPtr28CalendarSource(fixture));
    await selectRange("2026-10-05", "2026-10-05");
    const results = await screen.findByRole("region", { name: "Availability results" });
    expect(within(results).getByText("00:00–24:00")).toBeTruthy();
    expect(within(results).getByText("Available")).toBeTruthy();
    expect(within(results).queryByText("Confirmed booking")).toBeNull();
  });

  it("[PTR-28-TC01][AC1] shows an empty venue list without inventing availability", async () => {
    const source = createPtr28CalendarSource();
    setup({ ...source, listVenues: async () => [] });
    expect(await screen.findByText("No venues available to view yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Availability results" })).toBeNull();
  });

  it("[PTR-28-TC19][AC1][AC2] hides a failed schedule and recovers on retry", async () => {
    const source = createPtr28CalendarSource();
    const read = vi
      .fn<CalendarSource["read"]>(selection => source.read(selection))
      .mockRejectedValueOnce(new Error("private database detail"));
    const user = setup({ ...source, read });
    await selectRange();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Availability could not be loaded"
    );
    expect(screen.queryByText(/private database detail/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Availability results" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry availability" }));
    expect(await screen.findByRole("region", { name: "Availability results" })).toBeTruthy();
  });

  it("[PTR-28-TC19][AC1] retries a failed venue list", async () => {
    const source = createPtr28CalendarSource();
    const user = setup({
      ...source,
      listVenues: vi
        .fn<CalendarSource["listVenues"]>(() => source.listVenues())
        .mockRejectedValueOnce(new Error("unavailable")),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Venues could not be loaded");
    await user.click(screen.getByRole("button", { name: "Retry venues" }));
    expect(await screen.findByRole("option", { name: "Test Hall A" })).toBeTruthy();
  });

  it("[PTR-28-TC03][AC1] ignores a slow response for the previous venue", async () => {
    const source = createPtr28CalendarSource();
    const { promise: first, resolve: resolveFirst } = Promise.withResolvers<CalendarSchedule>();
    const user = setup({
      ...source,
      read: vi
        .fn<CalendarSource["read"]>(selection => source.read(selection))
        .mockImplementationOnce(() => first),
    });
    await selectRange();
    expect(await screen.findByText("Loading availability…")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Venue"), "VB");
    await user.click(screen.getByRole("button", { name: "Show availability" }));
    await screen.findByRole("region", { name: "Availability results" });
    await act(async () =>
      resolveFirst(
        await source.read({ venueId: "VA", startDate: "2026-10-05", endDate: "2026-10-07" })
      )
    );
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Test Hall A" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Test Hall B" })).toBeTruthy();
  });
});
