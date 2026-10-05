import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventRequestDetailPageSkeleton } from "#/features/event-requests/components/request-detail-page-skeleton";
import { EventRequestListPageSkeleton } from "#/features/event-requests/components/request-list-page-skeleton";
import { EventRequestsPageSkeleton } from "#/features/event-requests/components/request-page-skeleton";

/**
 * The pending components for the event request routes mirror the pages they stand in for. These
 * assertions pin the shells, the card and row counts, and the field grids, so a skeleton that
 * stops drawing a section is caught even though nothing has text.
 */
describe("EventRequestListPageSkeleton", () => {
  it("draws the wide loading shell with the table's header and rows", () => {
    const { container } = render(<EventRequestListPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-wide");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading your event requests…");

    // The header row plus one row per placeholder in the table.
    expect(container.querySelectorAll("div.divide-y > div")).toHaveLength(4);
  });
});

describe("EventRequestDetailPageSkeleton", () => {
  it("draws the loading shell with the recorded fields grid", () => {
    const { container } = render(<EventRequestDetailPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this event request…");

    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(container.querySelectorAll("dl > div")).toHaveLength(12);
    expect(container.querySelectorAll('dl > div[class*="sm:col-span-2"]')).toHaveLength(8);
  });
});

describe("EventRequestsPageSkeleton", () => {
  it("draws the loading shell with the form's field groups", () => {
    const { container } = render(<EventRequestsPageSkeleton />);

    const main = container.querySelector("main");
    expect(main?.className).toContain("max-w-page");
    expect(main?.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading this event request…");

    // The two separated field groups and the action row all carry the section border.
    expect(container.querySelectorAll('div[class*="border-t"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(22);
  });
});
