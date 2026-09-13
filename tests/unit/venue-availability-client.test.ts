import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarSource, CalendarRequestError } from "#/features/venues/calendar-data";
import { createPtr28CalendarSource } from "../fixtures/ptr-28";

afterEach(() => vi.unstubAllGlobals());
const selection = { venueId: "VA", startDate: "2026-10-05", endDate: "2026-10-07" };
type FetchCall = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

describe("PTR-28 HTTP data boundary", () => {
  it("[PTR-28-TC19][AC1][AC2] propagates server failure instead of fabricating empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => Response.json({ error: "private detail" }, { status: 503 }))
    );
    await expect(calendarSource.read(selection, new AbortController().signal)).rejects.toEqual(
      new CalendarRequestError(503)
    );
  });
  it.each(["wrong venue", "wrong dates", "invalid timezone", "invalid interval"])(
    "[PTR-28-TC19][AC1][AC2] rejects a successful HTTP response with %s",
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
                  available: [{ startsAt: "2026-10-05T12:00:00Z", endsAt: "2026-10-05T10:00:00Z" }],
                };
      vi.stubGlobal(
        "fetch",
        vi.fn<FetchCall>(async () => Response.json(changed))
      );
      await expect(calendarSource.read(selection, new AbortController().signal)).rejects.toThrow(
        "Invalid availability response"
      );
    }
  );
  it("[PTR-28-TC01][AC1] keeps query dates and cancellation signals intact", async () => {
    const data = await createPtr28CalendarSource().read(selection);
    const request = vi.fn<FetchCall>(async () => Response.json(data));
    vi.stubGlobal("fetch", request);
    const signal = new AbortController().signal;
    await expect(calendarSource.read(selection, signal)).resolves.toEqual(data);
    expect(request).toHaveBeenCalledWith(
      "/api/venue-availability?venueId=VA&startDate=2026-10-05&endDate=2026-10-07",
      { signal, credentials: "same-origin", cache: "no-store" }
    );
  });

  it("accepts floating venue-local timestamps without adding an offset", async () => {
    const data = await createPtr28CalendarSource().read(selection);
    const local = {
      ...data,
      timeZone: null,
      available: data.available.map(period => ({
        startsAt: period.startsAt.slice(0, 19),
        endsAt: period.endsAt.slice(0, 19),
      })),
      occupied: data.occupied.map(period =>
        Object.assign({}, period, {
          startsAt: period.startsAt.slice(0, 19),
          endsAt: period.endsAt.slice(0, 19),
          visibleStart: period.visibleStart.slice(0, 19),
          visibleEnd: period.visibleEnd.slice(0, 19),
        })
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => Response.json(local))
    );
    await expect(calendarSource.read(selection, new AbortController().signal)).resolves.toEqual(
      local
    );
  });

  it.each([
    { timeZone: null, timestamp: "2026-10-05T10:00:00+08:00" },
    { timeZone: "Asia/Singapore", timestamp: "2026-10-05T10:00:00" },
  ])("rejects a timestamp mode mismatch ($timeZone)", async ({ timeZone, timestamp }) => {
    const data = await createPtr28CalendarSource().read(selection);
    const changed = {
      ...data,
      timeZone,
      available: [{ startsAt: timestamp, endsAt: "2026-10-05T11:00:00+08:00" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchCall>(async () => Response.json(changed))
    );
    await expect(calendarSource.read(selection, new AbortController().signal)).rejects.toThrow(
      "Invalid availability response"
    );
  });
});
