// @vitest-environment jsdom
import { render as renderEmail } from "@react-email/render";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import {
  notificationHref,
  notificationReachable,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { projectAvailability } from "#/features/venues/availability";
import type { AvailabilityRecord, VenueBufferConflict } from "#/features/venues/availability";
import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import {
  VenueDetailPage,
  formatOccupiedPeriod,
} from "#/features/venues/components/venue-detail-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";

const { navigate, invalidate } = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => void>(),
  invalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("#/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate, navigate }),
}));

const staffUser: SessionUser = {
  id: "staff-1",
  name: "Staff User",
  email: "staff@example.com",
  role: "venue_staff",
};

const baseVenue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  setupMinutes: 30,
  turnaroundMinutes: 30,
  facilities: [],
  accessibilityFeatures: [],
  supportedLayouts: [],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("PTR-132-TC11: venue_buffer_conflict notification schema and email", () => {
  it("validates payloads, summaries, hrefs, reachability, and renders email", async () => {
    const validPayload = {
      eventName: "Annual Gala",
      venueName: "Great Hall",
      startsAt: "2026-11-10 10:00:00",
      endsAt: "2026-11-10 11:00:00",
      setupMinutes: 30,
      turnaroundMinutes: 30,
    };

    const parsed = parseNotificationPayload("venue_buffer_conflict", validPayload);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected valid payload to parse");
    expect(parsed.kind).toBe("venue_buffer_conflict");
    expect(parsed.payload).toEqual(validPayload);

    // Negative buffers or empty strings fail
    expect(
      parseNotificationPayload("venue_buffer_conflict", { ...validPayload, setupMinutes: -1 })
    ).toBeNull();
    expect(
      parseNotificationPayload("venue_buffer_conflict", { ...validPayload, turnaroundMinutes: -1 })
    ).toBeNull();
    expect(
      parseNotificationPayload("venue_buffer_conflict", { ...validPayload, eventName: "" })
    ).toBeNull();
    expect(
      parseNotificationPayload("venue_buffer_conflict", { ...validPayload, venueName: "   " })
    ).toBeNull();

    // Summary and href
    expect(notificationSummary(parsed)).toBe("Venue buffer conflict: Great Hall");
    expect(notificationHref({ ...parsed, eventRequestId: 42 })).toBe("/events/42");

    // Reachability
    expect(
      notificationReachable("venue_buffer_conflict", {
        eventAccessible: true,
        handoverPending: false,
      })
    ).toBe(true);
    expect(
      notificationReachable("venue_buffer_conflict", {
        eventAccessible: false,
        handoverPending: false,
      })
    ).toBe(false);

    // Email rendering
    const rendered = renderNotificationEmail({ ...parsed, eventRequestId: 42 });
    expect(rendered.subject).toBe("Venue buffer conflict: Great Hall");
    const html = await renderEmail(rendered.element);
    expect(html).toContain("Great Hall");
    expect(html).toContain("Annual Gala");
    expect(html).toContain("30 minutes of setup time");
    expect(html).toContain("30 minutes of turnaround time");

    // Multi-period payload validation and email rendering
    const multiPeriodPayload = {
      ...validPayload,
      periods: [
        { startsAt: "2026-11-10 10:00:00", endsAt: "2026-11-10 11:00:00" },
        { startsAt: "2026-11-10 14:00:00", endsAt: "2026-11-10 15:00:00" },
      ],
    };
    const parsedMulti = parseNotificationPayload("venue_buffer_conflict", multiPeriodPayload);
    expect(parsedMulti).not.toBeNull();
    if (!parsedMulti) throw new Error("Expected multi-period payload to parse");
    const multiRendered = renderNotificationEmail({ ...parsedMulti, eventRequestId: 42 });
    const multiHtml = await renderEmail(multiRendered.element);
    expect(multiHtml).toContain("10:00–11:00");
    expect(multiHtml).toContain("14:00–15:00");
  });
});

describe("PTR-132-TC10: availability projection and calendar conflict badges", () => {
  it("preserves bufferConflict on OccupiedPeriod and renders badge in VenueCalendarPage", () => {
    const bookings: AvailabilityRecord[] = [
      {
        id: "booking-conflict",
        label: "Flagged Booking",
        startsAt: "2026-11-10T10:00:00",
        endsAt: "2026-11-10T11:00:00",
        bufferConflict: true,
      },
      {
        id: "booking-clean",
        label: "Clear Booking",
        startsAt: "2026-11-10T16:00:00",
        endsAt: "2026-11-10T17:00:00",
      },
    ];

    const holds: AvailabilityRecord[] = [
      {
        id: "hold-conflict",
        label: "Flagged Hold",
        startsAt: "2026-11-10T11:30:00",
        endsAt: "2026-11-10T12:30:00",
        bufferConflict: true,
      },
    ];

    const projection = projectAvailability(
      { startsAt: "2026-11-10T08:00:00", endsAt: "2026-11-10T20:00:00" },
      {
        bookings,
        blocks: [],
        holds,
        openPeriods: [{ startsAt: "2026-11-10T08:00:00", endsAt: "2026-11-10T20:00:00" }],
      }
    );

    const flaggedBooking = projection.occupied.find(p => p.id === "booking-conflict");
    const clearBooking = projection.occupied.find(p => p.id === "booking-clean");
    const flaggedHold = projection.occupied.find(p => p.id === "hold-conflict");

    expect(flaggedBooking?.bufferConflict).toBe(true);
    expect(flaggedHold?.bufferConflict).toBe(true);
    expect(clearBooking?.bufferConflict).toBeUndefined();

    // Render calendar page with this projection
    const schedule: VenueAvailability = {
      venue: { id: 7, name: "Great Hall" },
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      available: projection.available,
      occupied: projection.occupied,
    };

    render(
      <VenueCalendarPage
        venues={[baseVenue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-11-10", endDate: "2026-11-10" }}
        user={staffUser}
      />
    );

    const badges = screen.getAllByText("Buffer conflict");
    // Two periods flagged: flagged booking and flagged hold
    expect(badges).toHaveLength(2);
  });
});

describe("PTR-132-TC09: VenueDetailPage lists flagged commitments", () => {
  it("renders the list of flagged commitments with kind label, event name, and period", () => {
    const conflicts: VenueBufferConflict[] = [
      {
        id: "req-1",
        kind: "booking",
        eventId: 101,
        eventName: "Annual Gala",
        startsAt: "2026-11-10 10:00:00",
        endsAt: "2026-11-10 11:00:00",
      },
      {
        id: "hold-2",
        kind: "hold",
        eventId: 102,
        eventName: "Midday Briefing",
        startsAt: "2026-11-10 11:30:00",
        endsAt: "2026-11-10 12:30:00",
      },
      {
        id: "req-3",
        kind: "suspended",
        eventId: 103,
        eventName: "Evening Workshop",
        startsAt: "2026-11-10 13:00:00",
        endsAt: "2026-11-10 14:00:00",
      },
    ];

    render(
      <VenueDetailPage
        venue={{ ...baseVenue, bufferConflicts: conflicts }}
        user={staffUser}
        justCreated={true}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByText("Venue saved.")).toBeTruthy();
    expect(screen.getByRole("region", { name: /flagged buffer conflicts/i })).toBeTruthy();
    expect(screen.getByText("Approved booking")).toBeTruthy();
    expect(screen.getByText("Active hold")).toBeTruthy();
    expect(screen.getByText("Block-suspended piece")).toBeTruthy();
    expect(screen.getByText("Annual Gala")).toBeTruthy();
    expect(screen.getByText("Midday Briefing")).toBeTruthy();
    expect(screen.getByText("Evening Workshop")).toBeTruthy();
  });

  it("formats single-day and multi-day occupied periods with formatOccupiedPeriod", () => {
    expect(formatOccupiedPeriod("2026-11-10 10:00:00", "2026-11-10 11:00:00")).toBe(
      "10 November 2026, 10:00–11:00"
    );
    expect(formatOccupiedPeriod("2026-11-10 22:00:00", "2026-11-11 02:00:00")).toBe(
      "10 November 2026, 22:00 – 11 November 2026, 02:00"
    );
  });
});
