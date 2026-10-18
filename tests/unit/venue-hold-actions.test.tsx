// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const {
  mockInvalidate,
  mockNavigate,
  mockCreateHold,
  mockReleaseHold,
  mockConvertHold,
  mockSetExpiry,
  mockSetWarning,
} = vi.hoisted(() => ({
  mockSetExpiry: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
  mockSetWarning: vi.fn<(input: unknown) => Promise<unknown>>().mockResolvedValue({}),
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
  setVenueHoldExpiry: mockSetExpiry,
  setVenueHoldWarning: mockSetWarning,
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
  setupMinutes: 0,
  turnaroundMinutes: 0,
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

/** The event's requirements, which the conversion form starts from (PTR-138 AC1). */
const eventRequirements = {
  expectedAttendance: 80,
  layout: "Theatre seating",
  accessibilityRequirements: "Step-free access",
  requiredFacilities: "Projector",
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
      canRelease: true,
      convertDefaults: eventRequirements,
    },
  ],
};

/** The same hold as seen by a viewer who cannot manage it. */
const scheduleWithUnownedHold: VenueAvailability = {
  ...scheduleWithHold,
  occupied: [
    {
      ...scheduleWithHold.occupied[0],
      canRelease: false,
      convertDefaults: undefined,
    },
  ],
};

const withExpiry = (
  expiresAt: string | null,
  warnAt: string | null,
  canSetWarning: boolean,
  canChangeHold = true
) => ({
  ...scheduleWithHold,
  occupied: [{ ...scheduleWithHold.occupied[0], expiresAt, warnAt, canChangeHold, canSetWarning }],
});
const renderAs = (user: SessionUser, schedule: VenueAvailability) =>
  render(
    <VenueCalendarPage
      venues={[venue]}
      schedule={schedule}
      search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      user={user}
      coordinatorEvents={[]}
    />
  );

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
      mockReleaseHold.mockRejectedValueOnce(new Error("This hold is no longer active."));
      const user = userEvent.setup();
      render(<ReleaseVenueHoldButton holdId="hold-42" />);

      await user.click(screen.getByRole("button", { name: "Release tentative hold" }));
      await user.click(await screen.findByRole("button", { name: "Confirm release" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain("no longer active");
      });
    });
  });

  describe("ConvertVenueHoldButton", () => {
    it("converts with the event's requirements as the session's, prefilled", async () => {
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" requirements={eventRequirements} />);

      const trigger = screen.getByRole("button", {
        name: "Convert tentative hold to booking request",
      });
      expect(trigger).toBeTruthy();
      await user.click(trigger);

      expect(await screen.findByLabelText("Expected attendance")).toHaveProperty("value", "80");
      expect(screen.getByLabelText("Layout")).toHaveProperty("value", "Theatre seating");
      expect(screen.getByLabelText("Accessibility")).toHaveProperty("value", "Step-free access");
      expect(screen.getByLabelText("Facilities")).toHaveProperty("value", "Projector");
      await user.click(screen.getByRole("button", { name: "Confirm conversion" }));

      await waitFor(() => {
        expect(mockConvertHold).toHaveBeenCalledWith({
          data: { id: "hold-42", ...eventRequirements },
        });
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });

    it("sends the session values the Coordinator changed (PTR-138 AC1)", async () => {
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" requirements={eventRequirements} />);

      await user.click(
        screen.getByRole("button", { name: "Convert tentative hold to booking request" })
      );
      await user.clear(await screen.findByLabelText("Expected attendance"));
      await user.type(screen.getByLabelText("Expected attendance"), "30");
      await user.clear(screen.getByLabelText("Facilities"));
      await user.click(screen.getByRole("button", { name: "Confirm conversion" }));

      await waitFor(() => {
        expect(mockConvertHold).toHaveBeenCalledWith({
          data: {
            id: "hold-42",
            expectedAttendance: 30,
            layout: "Theatre seating",
            accessibilityRequirements: "Step-free access",
            requiredFacilities: "",
          },
        });
      });
    });

    it("refuses a layout that names no supported layout before calling the server", async () => {
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" requirements={eventRequirements} />);

      await user.click(
        screen.getByRole("button", { name: "Convert tentative hold to booking request" })
      );
      await user.clear(await screen.findByLabelText("Layout"));
      await user.type(screen.getByLabelText("Layout"), "Round tables");
      await user.click(screen.getByRole("button", { name: "Confirm conversion" }));

      expect(await screen.findByText("Choose only from the supported room layouts")).toBeTruthy();
      expect(screen.getByLabelText("Layout").getAttribute("aria-invalid")).toBe("true");
      expect(mockConvertHold).not.toHaveBeenCalled();
    });

    it("displays error message if convertVenueHold fails", async () => {
      mockConvertHold.mockRejectedValueOnce(
        new Error("This hold is no longer active or has been converted.")
      );
      const user = userEvent.setup();
      render(<ConvertVenueHoldButton holdId="hold-42" requirements={eventRequirements} />);

      await user.click(
        screen.getByRole("button", { name: "Convert tentative hold to booking request" })
      );
      await user.click(await screen.findByRole("button", { name: "Confirm conversion" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain(
          "no longer active or has been converted"
        );
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

      expect(screen.getByText("You have no events that can take a venue hold.")).toBeTruthy();
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

      // The role permits new holds, so keep "Hold slot". The viewer does not own this hold, so
      // remove "Release" and "Convert".
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
            canRelease: true,
            convertDefaults: undefined,
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
            canRelease: true,
            convertDefaults: undefined,
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

    describe("hold expiry (PTR-142)", () => {
      it("shows the Coordinator the expiry and the warning, and a warning control (AC3)", () => {
        renderAs(coordinatorUser, withExpiry("2026-10-04T12:00:00", "2026-10-03T09:00:00", true));
        expect(screen.getByText(/Expires 4 Oct 2026, 12:00/)).toBeTruthy();
        expect(screen.getByText(/Warning 3 Oct 2026, 09:00/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Change warning" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /expiry/ })).toBeNull();
      });

      it("hides the warning trigger until an expiry exists", () => {
        renderAs(coordinatorUser, withExpiry(null, null, true, true));
        expect(screen.getByText(/No expiry set/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: /warning/i })).toBeNull();
      });

      it("shows neither trigger for a hold on a cancelled event", () => {
        renderAs(staffUser, withExpiry("2026-10-04T12:00:00", null, false, false));
        expect(screen.queryByRole("button", { name: /expiry/i })).toBeNull();
        expect(screen.queryByRole("button", { name: /warning/i })).toBeNull();
      });

      it("flags a hold without an expiry and offers Venue Staff the setter", async () => {
        const user = userEvent.setup();
        renderAs(staffUser, withExpiry(null, null, false));
        expect(screen.getByText(/No expiry set/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: /warning/i })).toBeNull();

        await user.click(screen.getByRole("button", { name: "Set expiry" }));
        await user.type(screen.getByLabelText("Date and time"), "2026-10-04T12:00");
        await user.click(screen.getByRole("button", { name: "Save expiry" }));
        await waitFor(() =>
          expect(mockSetExpiry).toHaveBeenCalledWith({
            data: { id: "hold-42", expiresAt: "2026-10-04T12:00" },
          })
        );
      });

      it("shows a server refusal in the dialog", async () => {
        mockSetExpiry.mockRejectedValueOnce(new Error("The expiry must be in the future"));
        const user = userEvent.setup();
        renderAs(staffUser, withExpiry(null, null, false));

        await user.click(screen.getByRole("button", { name: "Set expiry" }));
        await user.type(screen.getByLabelText("Date and time"), "2026-10-04T12:00");
        await user.click(screen.getByRole("button", { name: "Save expiry" }));

        await waitFor(() =>
          expect(screen.getByRole("alert").textContent).toContain("must be in the future")
        );
      });

      it("lets the Coordinator clear the warning", async () => {
        const user = userEvent.setup();
        renderAs(coordinatorUser, withExpiry("2026-10-04T12:00:00", "2026-10-03T09:00:00", true));
        await user.click(screen.getByRole("button", { name: "Change warning" }));
        await user.click(screen.getByRole("button", { name: "Clear" }));
        await waitFor(() =>
          expect(mockSetWarning).toHaveBeenCalledWith({ data: { id: "hold-42", warnAt: null } })
        );
      });

      it("refuses a blank warning instead of clearing it", async () => {
        const user = userEvent.setup();
        renderAs(coordinatorUser, withExpiry("2026-10-04T12:00:00", "2026-10-03T09:00:00", true));

        await user.click(screen.getByRole("button", { name: "Change warning" }));
        const input = screen.getByLabelText("Date and time");
        await user.clear(input);

        expect(screen.getByRole("button", { name: "Save warning" })).toHaveProperty(
          "disabled",
          true
        );

        const form = input.closest("form");
        expect(form).toBeTruthy();
        fireEvent.submit(form as HTMLFormElement);

        expect(await screen.findByText("Enter a valid warning date and time")).toBeTruthy();
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(mockSetWarning).not.toHaveBeenCalled();
      });

      it("renders no action group when the warning flag has no expiry", () => {
        const noExpiry = withExpiry(null, null, true);
        const unowned: VenueAvailability = {
          ...noExpiry,
          occupied: [{ ...noExpiry.occupied[0], canRelease: false, convertDefaults: undefined }],
        };
        renderAs(coordinatorUser, unowned);

        const row = screen.getByText("No expiry set").closest("li");
        expect(row).toBeTruthy();
        expect(within(row as HTMLElement).queryAllByRole("button")).toHaveLength(0);
        expect(row?.querySelector("div.flex.items-center.gap-2")).toBeNull();
      });
    });
  });
});
