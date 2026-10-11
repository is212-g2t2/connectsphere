// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VenueDetailPageSkeleton } from "#/features/venues/components/venue-detail-page-skeleton";

/** The pending component must match the venue record's shell and field grid. The edit form, record,
 * and request panel are role-gated, so the skeleton must not show a form or button. These tests
 * keep that shape when the skeleton has no text.
 */
describe("VenueDetailPageSkeleton", () => {
  it("draws the page-width shell with the record's field grid and no role-gated controls", () => {
    const { container } = render(<VenueDetailPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this venue…");

    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    // Five plain fields plus the wide operating-hours block.
    const fields = container.querySelectorAll("dl > div");
    expect(fields).toHaveLength(6);
    expect(fields.item(5).className).toContain("sm:col-span-2");
  });
});
