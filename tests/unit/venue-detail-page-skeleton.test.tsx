import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VenueDetailPageSkeleton } from "#/features/venues/components/venue-detail-page-skeleton";

/**
 * The pending component mirrors the venue record: the page-width shell and the field grid. The
 * edit form, the read-only record and PTR-31's request panel are role-gated, so the skeleton must
 * not draw a form or any button (the `VenueListPageSkeleton` rule); these assertions hold that
 * shape even though nothing has text.
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
