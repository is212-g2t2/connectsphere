import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectEvent } from "#/features/events/access";
import { Route as EventRoute } from "#/routes/_authenticated/events/$eventId";

const { mockListEvents } = vi.hoisted(() => ({
  mockListEvents: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock("#/features/events/server-fns", () => ({ listEvents: mockListEvents }));

type Guard = (args: { context: { user: { role: string } } }) => void;
type Loader = (args: { params: { eventId: string } }) => Promise<unknown>;

describe("event route guard", () => {
  const beforeLoad = EventRoute.options.beforeLoad as unknown as Guard;

  it.each(["event_organiser", "event_coordinator", "venue_staff", "technical_support_staff"])(
    "redirects %s to /dashboard",
    role => {
      expect(() => beforeLoad({ context: { user: { role } } })).toThrow(
        expect.objectContaining({ options: expect.objectContaining({ to: "/dashboard" }) })
      );
    }
  );

  it("lets an attendee through", () => {
    expect(() => beforeLoad({ context: { user: { role: "attendee" } } })).not.toThrow();
  });
});

describe("event route loader", () => {
  const loader = EventRoute.options.loader as unknown as Loader;
  beforeEach(() => {
    mockListEvents.mockReset();
  });

  it.each(["abc", "0", "-1", "7.5"])(
    "treats a junk id %s as notFound without a round trip",
    async eventId => {
      await expect(loader({ params: { eventId } })).rejects.toMatchObject({
        isNotFound: true,
      });
      expect(mockListEvents).not.toHaveBeenCalled();
    }
  );

  it("turns a Forbidden refusal into notFound", async () => {
    mockListEvents.mockImplementation(async () => {
      throw new Error("Forbidden");
    });
    await expect(loader({ params: { eventId: "7" } })).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it("lets any other error propagate", async () => {
    mockListEvents.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    await expect(loader({ params: { eventId: "7" } })).rejects.toThrow("connection refused");
  });

  it("treats an empty answer as notFound", async () => {
    mockListEvents.mockResolvedValue([]);
    await expect(loader({ params: { eventId: "7" } })).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it("resolves to the named projection", async () => {
    const projection = { event: { id: 7, status: "confirmed", registrationEnabled: true } };
    mockListEvents.mockResolvedValue([projection]);
    await expect(loader({ params: { eventId: "7" } })).resolves.toEqual(projection);
    expect(mockListEvents).toHaveBeenCalledWith({ data: { eventId: 7 } });
  });

  it.each([
    { name: "a non-confirmed event", event: { id: 7, status: "submitted" } },
    {
      name: "a registration-disabled event",
      event: { id: 7, status: "confirmed", registrationEnabled: false },
    },
    {
      name: "a confirmed event with the registration flag missing",
      event: { id: 7, status: "confirmed" },
    },
  ])("throws notFound for $name even when the server answers", async ({ event }) => {
    mockListEvents.mockResolvedValue([{ event }]);
    await expect(loader({ params: { eventId: "7" } })).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it("resolves to the real attendee projection shape", async () => {
    const venue = {
      name: "Hall A",
      location: "Fixture location",
      date: "2026-12-05",
      endDate: "2026-12-05",
      startTime: "10:00",
      endTime: "15:00",
    };
    const projection = projectEvent(
      {
        id: 7,
        name: "Confirmed open event",
        description: "A confirmed event",
        status: "confirmed",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T15:00" }],
        registrationEnabled: true,
        expectedAttendance: 50,
        roomLayoutPreference: "Theatre",
        accessibilityRequirements: "Step-free access",
        venueRequirements: "Near MRT",
        registrationOpensAt: "2020-01-01T00:00",
        registrationClosesAt: "2099-01-01T00:00",
      },
      "attendee",
      null,
      [],
      null,
      venue
    );
    mockListEvents.mockResolvedValue([projection]);
    await expect(loader({ params: { eventId: "7" } })).resolves.toEqual(projection);
  });
});
