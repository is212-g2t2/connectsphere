// @vitest-environment jsdom
import { render as renderEmail } from "@react-email/render";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { formatPeriod } from "#/features/emails/format";
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
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { DEFAULT_OPERATING_HOURS, INITIAL_ROOM_LAYOUTS } from "#/features/venues/schema";
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
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
  }) => {
    const query = search
      ? `?${Object.entries(search)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join("&")}`
      : "";
    return <a href={`${to}${query}`}>{children}</a>;
  },
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
      venueId: 7,
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

    // Summary and href: name the event and venue, then open the calendar on the disputed days.
    expect(notificationSummary(parsed)).toBe("Venue buffer conflict: Annual Gala at Great Hall");
    expect(notificationHref({ ...parsed, eventRequestId: 42 })).toBe(
      "/venues/availability?venueId=7&startDate=2026-11-10&endDate=2026-11-10"
    );

    // Reachability
    expect(notificationReachable(parsed, { eventAccessible: true })).toBe(true);
    expect(notificationReachable(parsed, { eventAccessible: false })).toBe(false);

    // Email rendering, including the calendar link.
    const rendered = renderNotificationEmail({ ...parsed, eventRequestId: 42 });
    expect(rendered.subject).toBe("Venue buffer conflict: Annual Gala at Great Hall");
    const html = await renderEmail(rendered.element);
    expect(html).toContain("Great Hall");
    expect(html).toContain("Annual Gala");
    expect(html).toContain("30 minutes of setup time");
    expect(html).toContain("30 minutes of turnaround time");
    expect(html).toContain("View venue calendar");
    expect(html).toContain("venueId=7&amp;startDate=2026-11-10&amp;endDate=2026-11-10");

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
    expect(multiHtml).toContain("View venue calendar");
    expect(multiHtml).toContain("venueId=7");
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
      requestedHolds: [],
    };

    render(
      <VenueCalendarPage
        venues={[baseVenue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-11-10", endDate: "2026-11-10" }}
        user={staffUser}
      />
    );

    const legend = screen.getByRole("list", { name: "Availability legend" });
    expect(within(legend).getByText("Buffer conflict")).toBeTruthy();
    const badges = screen.getAllByText("Buffer conflict");
    // Two flagged periods plus the legend entry.
    expect(badges).toHaveLength(3);
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
        layouts={INITIAL_ROOM_LAYOUTS}
        user={staffUser}
        justCreated={true}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByText("Venue saved. 3 commitments now conflict.")).toBeTruthy();
    expect(screen.getByRole("region", { name: /flagged buffer conflicts/i })).toBeTruthy();
    expect(
      screen.getByText(
        /Venue Staff release or amend a flagged booking \(the Coordinator releases one that a block suspended\), and the Coordinator releases a flagged hold\./
      )
    ).toBeTruthy();
    expect(screen.getByText("Approved booking")).toBeTruthy();
    expect(screen.getByText("Active hold")).toBeTruthy();
    expect(screen.getByText("Block-suspended piece")).toBeTruthy();
    expect(screen.getByText("Annual Gala")).toBeTruthy();
    expect(screen.getByText("Midday Briefing")).toBeTruthy();
    expect(screen.getByText("Evening Workshop")).toBeTruthy();

    // Every period links to the venue calendar for that commitment's own dates.
    const calendarHref = "/venues/availability?venueId=7&startDate=2026-11-10&endDate=2026-11-10";
    for (const period of [
      "10 November 2026, 10:00–11:00",
      "10 November 2026, 11:30–12:30",
      "10 November 2026, 13:00–14:00",
    ]) {
      expect(screen.getByRole("link", { name: period }).getAttribute("href")).toBe(calendarHref);
    }
  });

  it("formats single-day and multi-day periods with formatPeriod", () => {
    expect(formatPeriod("2026-11-10 10:00:00", "2026-11-10 11:00:00")).toBe(
      "10 November 2026, 10:00–11:00"
    );
    expect(formatPeriod("2026-11-10 22:00:00", "2026-11-11 02:00:00")).toBe(
      "10 November 2026, 22:00 – 11 November 2026, 02:00"
    );
  });
});
