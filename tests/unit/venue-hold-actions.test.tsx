import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import {
  ConvertVenueHoldButton,
  PlaceVenueHoldDialog,
  ReleaseVenueHoldButton,
} from "#/features/venue-requests/components/venue-hold-actions";
import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";

const { mockInvalidate, mockNavigate, mockCreateHold, mockReleaseHold, mockConvertHold } =
  vi.hoisted(() => ({
    mockInvalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    mockNavigate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    mockCreateHold: vi.fn<() => Promise<{ id: string; status: string }>>().mockResolvedValue({
      id: "hold-new",
      status: "held",
    }),
    mockReleaseHold: vi.fn<() => Promise<{ id: string; status: string }>>().mockResolvedValue({
      id: "hold-1",
      status: "released",
    }),
    mockConvertHold: vi
      .fn<
        () => Promise<{
          hold: { id: string; status: string };
          request: { id: string; status: string };
        }>
      >()
      .mockResolvedValue({
        hold: { id: "hold-1", status: "released" },
        request: { id: "req-1", status: "pending" },
      }),
  }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
  useRouter: () => ({
    invalidate: mockInvalidate,
    navigate: mockNavigate,
  }),
}));

vi.mock("#/features/venue-requests/server-fns", () => ({
  createVenueHold: mockCreateHold,
  releaseVenueHold: mockReleaseHold,
  convertVenueHold: mockConvertHold,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<(msg?: unknown) => void>(),
    error: vi.fn<(msg?: unknown) => void>(),
  },
}));

const venue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  facilities: [],
  accessibilityFeatures: [],
  supportedLayouts: [],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const coordinatorUser: SessionUser = {
  id: "coord-1",
  name: "Coordinator User",
  email: "coord@example.com",
  role: "event_coordinator",
};

const staffUser: SessionUser = {
  id: "staff-1",
  name: "Staff User",
  email: "staff@example.com",
  role: "venue_staff",
};

const scheduleWithHold: VenueAvailability = {
  venue: { id: 7, name: "Great Hall" },
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  available: [{ startsAt: "2026-10-05T08:00:00", endsAt: "2026-10-05T12:00:00" }],
  occupied: [
    {
      id: "hold-42",
      state: "tentative_hold",
      label: "Tentative hold",
      startsAt: "2026-10-05T13:00:00",
      endsAt: "2026-10-05T15:00:00",
      visibleStart: "2026-10-05T13:00:00",
      visibleEnd: "2026-10-05T15:00:00",
      canManage: true,
      canRelease: true,
      canConvert: true,
    },
  ],
};

/** The same hold as a viewer who may not manage it sees it. */
const scheduleWithUnownedHold: VenueAvailability = {
  ...scheduleWithHold,
  occupied: [
    {
      ...scheduleWithHold.occupied[0],
      canManage: false,
      canRelease: false,
      canConvert: false,
    },
  ],
};

describe("venue hold action components and calendar write-path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateHold.mockResolvedValue({ id: "hold-new", status: "held" });
    mockReleaseHold.mockResolvedValue({ id: "hold-1", status: "released" });
    mockConvertHold.mockResolvedValue({
      hold: { id: "hold-1", status: "released" },
      request: { id: "req-1", status: "pending" },
    });
  });

  describe("ReleaseVenueHoldButton", () => {
    it("renders release button and calls releaseVenueHold on confirmation", async () => {
      const user = userEvent.setup();
      render(<ReleaseVenueHoldButton holdId="hold-42" />);

      const trigger = screen.getByRole("button", { name: "Release tentative hold" });
      expect(trigger).toBeTruthy();
      await user.click(trigger);

      const confirmBtn = await screen.findByRole("button", { name: "Confirm release" });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockReleaseHold).toHaveBeenCalledWith({ data: { id: "hold-42" } });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("displays error message if releaseVenueHold fails", async () => {
      mockReleaseHold.mockRejectedValueOnce(new Error("This hold has already been released."));
      const user = userEvent.setup();
      render(<ReleaseVenueHoldButton holdId="hold-42" />);

      await user.click(screen.getByRole("button", { name: "Release tentative hold" }));
      await user.click(await screen.findByRole("button", { name: "Confirm release" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("already been released");
      });
    });
  });

  describe("ConvertVenueHoldButton", () => {
    it("renders convert button and calls convertVenueHold on confirmation", async () => {
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" />);

      const trigger = screen.getByRole("button", {
        name: "Convert tentative hold to booking request",
      });
      expect(trigger).toBeTruthy();
      await user.click(trigger);

      const confirmBtn = await screen.findByRole("button", { name: "Confirm convert" });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockConvertHold).toHaveBeenCalledWith({ data: { id: "hold-42" } });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("displays error message if convertVenueHold fails", async () => {
      mockConvertHold.mockRejectedValueOnce(new Error("This hold has already been converted."));
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" />);

      await user.click(
        screen.getByRole("button", { name: "Convert tentative hold to booking request" })
      );
      await user.click(await screen.findByRole("button", { name: "Confirm convert" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("already been converted");
      });
    });
  });

  describe("PlaceVenueHoldDialog", () => {
    it("submits valid hold and closes dialog", async () => {
      const user = userEvent.setup();
      render(
        <PlaceVenueHoldDialog
          venueId={7}
          venueName="Great Hall"
          defaultDate="2026-10-05"
          defaultStartTime="09:00"
          defaultEndTime="12:00"
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      await user.click(screen.getByRole("button", { name: "Place tentative hold" }));
      expect(await screen.findByRole("heading", { name: "Place tentative hold" })).toBeTruthy();

      await user.click(screen.getByRole("button", { name: "Place hold" }));

      await waitFor(() => {
        expect(mockCreateHold).toHaveBeenCalledWith({
          data: {
            venueId: 7,
            eventId: 101,
            date: "2026-10-05",
            startTime: "09:00",
            endTime: "12:00",
          },
        });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("shows server conflict error in dialog when hold placement conflicts", async () => {
      mockCreateHold.mockRejectedValueOnce(
        new Error("Great Hall is already booked 2026-10-05 09:00 – 12:00")
      );
      const user = userEvent.setup();
      render(
        <PlaceVenueHoldDialog
          venueId={7}
          venueName="Great Hall"
          defaultDate="2026-10-05"
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      await user.click(screen.getByRole("button", { name: "Place tentative hold" }));
      await user.click(screen.getByRole("button", { name: "Place hold" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("already booked");
      });
    });

    it("shows the no-events message and disables submit when coordinatorEvents is empty", async () => {
      const user = userEvent.setup();
      render(
        <PlaceVenueHoldDialog
          venueId={7}
          venueName="Great Hall"
          defaultDate="2026-10-05"
          coordinatorEvents={[]}
        />
      );

      await user.click(screen.getByRole("button", { name: "Place tentative hold" }));

      expect(screen.getByText("You have no submitted events to hold a venue for.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Place hold" })).toHaveProperty("disabled", true);
    });

    it("displays validation error when start time is after end time", async () => {
      const user = userEvent.setup();
      render(
        <PlaceVenueHoldDialog
          venueId={7}
          venueName="Great Hall"
          defaultDate="2026-10-05"
          defaultStartTime="14:00"
          defaultEndTime="10:00"
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      await user.click(screen.getByRole("button", { name: "Place tentative hold" }));
      await user.click(screen.getByRole("button", { name: "Place hold" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeTruthy();
        expect(mockCreateHold).not.toHaveBeenCalled();
      });
    });
  });

  describe("VenueCalendarPage hold integration", () => {
    it("renders hold controls for Coordinator user", () => {
      render(
        <VenueCalendarPage
          venues={[venue]}
          schedule={scheduleWithHold}
          search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
          user={coordinatorUser}
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      // Header should have Place tentative hold dialog button
      expect(screen.getByRole("button", { name: "Place tentative hold" })).toBeTruthy();

      // Available period should have Hold slot button
      expect(screen.getByRole("button", { name: "Hold slot" })).toBeTruthy();

      // Tentative hold period should have Release and Convert buttons
      expect(screen.getByRole("button", { name: "Release tentative hold" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Convert tentative hold to booking request" })
      ).toBeTruthy();
    });

    it("does not render hold write controls for non-coordinator user", () => {
      render(
        <VenueCalendarPage
          venues={[venue]}
          schedule={scheduleWithUnownedHold}
          search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
          user={staffUser}
        />
      );

      expect(screen.queryByRole("button", { name: "Place tentative hold" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Hold slot" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Release tentative hold" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Convert tentative hold to booking request" })
      ).toBeNull();
    });

    it("hides Release and Convert for a tentative hold the viewer cannot manage", () => {
      render(
        <VenueCalendarPage
          venues={[venue]}
          schedule={scheduleWithUnownedHold}
          search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
          user={coordinatorUser}
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      // Placing a new hold is a role capability, so "Hold slot" stays; acting on someone
      // else's hold is per-record ownership, so Release/Convert go.
      expect(screen.getByRole("button", { name: "Hold slot" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Release tentative hold" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Convert tentative hold to booking request" })
      ).toBeNull();
    });

    it("does not render release or convert for staff user even on an orphan hold", () => {
      const scheduleWithOrphanHold: VenueAvailability = {
        ...scheduleWithHold,
        occupied: [
          {
            ...scheduleWithHold.occupied[0],
            canManage: true,
            canRelease: true,
            canConvert: false,
          },
        ],
      };

      render(
        <VenueCalendarPage
          venues={[venue]}
          schedule={scheduleWithOrphanHold}
          search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
          user={staffUser}
        />
      );

      expect(screen.queryByRole("button", { name: "Release tentative hold" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Convert tentative hold to booking request" })
      ).toBeNull();
    });

    it("renders only Release button for Coordinator when hold is not convertible", () => {
      const scheduleWithReleaseOnlyHold: VenueAvailability = {
        ...scheduleWithHold,
        occupied: [
          {
            ...scheduleWithHold.occupied[0],
            canManage: true,
            canRelease: true,
            canConvert: false,
          },
        ],
      };

      render(
        <VenueCalendarPage
          venues={[venue]}
          schedule={scheduleWithReleaseOnlyHold}
          search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
          user={coordinatorUser}
          coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
        />
      );

      expect(screen.getByRole("button", { name: "Release tentative hold" })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Convert tentative hold to booking request" })
      ).toBeNull();
    });
  });
});
