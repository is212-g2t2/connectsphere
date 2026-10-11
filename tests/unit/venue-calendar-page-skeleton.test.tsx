// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VenueCalendarPageSkeleton } from "#/features/venues/components/venue-calendar-page-skeleton";

/** The pending component must match the venue calendar's wide shell, month grid, and availability
 * message. It must not show the filter form or role-gated hold buttons. These tests keep that shape
 * when the skeleton has no text.
 */
describe("VenueCalendarPageSkeleton", () => {
  it("draws the wide loading shell, the availability message, and no role-gated controls", () => {
    const { container } = render(<VenueCalendarPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading venue availability…");

    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
