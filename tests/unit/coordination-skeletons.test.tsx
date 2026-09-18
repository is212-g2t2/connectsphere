import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CoordinationPageSkeleton } from "#/features/coordination/components/coordination-page-skeleton";
import { CoordinationRequestPageSkeleton } from "#/features/coordination/components/coordination-request-page-skeleton";

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

describe("CoordinationRequestPageSkeleton", () => {
  it("draws the detail loading shell with its two cards and eight recorded fields", () => {
    const { container } = render(<CoordinationRequestPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this request…");

    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(2);
    expect(container.querySelectorAll("dl > div")).toHaveLength(8);
    expect(container.querySelectorAll('dl > div[class*="sm:col-span-2"]')).toHaveLength(4);
  });
});
