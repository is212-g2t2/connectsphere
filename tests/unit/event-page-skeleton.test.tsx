import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventPageSkeleton } from "#/features/events/components/event-page-skeleton";

/**
 * The pending component mirrors the event page: the wide shell, the cover square beside the
 * right column, and the registration card's shape. Nothing has text; these assertions hold the
 * layout the route swaps in while its loader resolves.
 */
describe("EventPageSkeleton", () => {
  it("draws the wide loading shell with the cover and the published-detail blocks", () => {
    const { container } = render(<EventPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this event…");

    // The two-column grid and its square cover.
    expect(main?.innerHTML).toContain("grid-cols-[300px_minmax(0,1fr)]");
    expect(container.querySelector(".aspect-square")?.className).toContain("rounded-2xl");

    // The registration card plus the right column's placeholder rows.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(10);
  });
});
