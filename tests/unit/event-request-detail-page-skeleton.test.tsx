import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventRequestDetailPageSkeleton } from "#/features/event-requests/components/request-detail-page-skeleton";

/**
 * The pending component for the event request detail route mirrors the page it stands in for.
 * These assertions pin the shell, the single recorded-fields card and its field counts, so a
 * skeleton that stops drawing the record is caught even though nothing has text.
 */
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
