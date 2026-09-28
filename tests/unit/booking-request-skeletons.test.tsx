import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BookingRequestDetailsSkeleton } from "#/features/venue-requests/components/booking-request-details-skeleton";
import { BookingRequestQueueSkeleton } from "#/features/venue-requests/components/booking-request-queue-skeleton";
import { VenueBookingsSkeleton } from "#/features/venue-requests/components/venue-bookings-skeleton";

/**
 * The pending components mirror the pages they stand in for: the queue's wide shell with its
 * six-column rows (the sixth standing in for the Action column), and the detail's page-width
 * record and requirement grids. These assertions pin the structure — and the absence of the
 * interactive controls the loaded pages render — so a skeleton that stops drawing a section is
 * caught even though nothing has text.
 */
describe("BookingRequestQueueSkeleton", () => {
  it("draws the wide loading shell with the six-column row placeholders", () => {
    const { container } = render(<BookingRequestQueueSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading pending booking requests…");

    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(4);
    expect(rows.item(0).children).toHaveLength(6);

    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BookingRequestDetailsSkeleton", () => {
  it("draws the page-width shell with the record and requirement field grids", () => {
    const { container } = render(<BookingRequestDetailsSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this booking request…");

    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);

    // Five record fields, the last one (event timing) spanning both columns.
    const recordFields = container.querySelectorAll("dl > div");
    expect(recordFields).toHaveLength(5);
    expect(recordFields.item(4).className).toContain("sm:col-span-2");

    // The shared requirements treatment's four fields follow the record grid.
    expect(container.querySelectorAll("dl + div > div")).toHaveLength(4);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("VenueBookingsSkeleton", () => {
  it("announces loading and mirrors the booking-card layout", () => {
    const { container } = render(<VenueBookingsSkeleton />);

    expect(screen.getByText("Loading approved bookings…")).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
