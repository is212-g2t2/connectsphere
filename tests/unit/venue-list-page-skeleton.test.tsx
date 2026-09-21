import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VenueListPageSkeleton } from "#/features/venues/components/venue-list-page-skeleton";

/**
 * The pending component mirrors the venue list: the wide shell and the five-column results table.
 * The search card is role-gated, so the skeleton must not draw it (the `DashboardPageSkeleton`
 * rule); these assertions hold that shape even though nothing has text.
 */
describe("VenueListPageSkeleton", () => {
  it("draws the wide loading shell with the five-column results table", () => {
    const { container } = render(<VenueListPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading venues…");

    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);

    // The header row plus one row per placeholder result.
    const rows = container.querySelectorAll("div.divide-y > div");
    expect(rows).toHaveLength(4);
    expect(rows.item(1).children).toHaveLength(5);
  });
});
