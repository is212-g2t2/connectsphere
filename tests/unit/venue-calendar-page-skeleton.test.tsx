import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VenueCalendarPageSkeleton } from "#/features/venues/components/venue-calendar-page-skeleton";

/**
 * The pending component mirrors the venue calendar: the wide shell, the sidebar month grid, and
 * the availability message. The filter form and the role-gated hold buttons are omitted so the
 * skeleton never promises controls the arriving user may not have (the `VenueListPageSkeleton`
 * rule); these assertions hold that shape even though nothing has text.
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
