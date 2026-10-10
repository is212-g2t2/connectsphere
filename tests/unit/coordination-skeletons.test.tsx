import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoordinationPageSkeleton } from "#/features/coordination/components/coordination-page-skeleton";

/**
 * The pending components (PTR-16) mirror the pages they stand in for. These assertions pin the
 * structure — the wide column, the `aria-busy` shell, the posted row counts and the two-card
 * detail — so a skeleton that stops drawing a section is caught even though nothing has text.
 */
describe("CoordinationPageSkeleton", () => {
  it("draws the wide loading shell with both assignment sections", () => {
    const { container } = render(<CoordinationPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading coordination requests…");

    expect(container.querySelectorAll("ul.divide-y > li")).toHaveLength(3);
    // The header row plus one row per placeholder in the unassigned table.
    expect(container.querySelectorAll("div.divide-y > div")).toHaveLength(5);
  });
});
