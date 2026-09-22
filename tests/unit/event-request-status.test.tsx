import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventRequestStatusBadge } from "#/features/event-requests/components/status-badge";
import {
  EVENT_REQUEST_STATUS_LABELS,
  EVENT_REQUEST_STATUS_VARIANTS,
  EVENT_REQUEST_STATUSES,
} from "#/features/event-requests/schema";

/**
 * PTR-21 criterion 1: the defined set the story names, plus `awaiting_organiser`, which PTR-18
 * writes when a Coordinator asks the Organiser something. Restated here so widening the enum has
 * to be written twice and can never be a slip; `tests/unit/db-schema.test.ts` holds the enum
 * itself to `EVENT_REQUEST_STATUSES`.
 */
const DEFINED_SET = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "planning",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
  "awaiting_organiser",
];

describe("Event request statuses (PTR-21)", () => {
  it("holds exactly the defined set", () => {
    expect([...EVENT_REQUEST_STATUSES].toSorted()).toEqual(DEFINED_SET.toSorted());
  });

  it.each(EVENT_REQUEST_STATUSES)("labels %s in plain language, not as a code", status => {
    const label = EVENT_REQUEST_STATUS_LABELS[status];
    expect(label).not.toContain("_");
    // A code reads `under_review`; a label reads `Under review`.
    expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
  });

  it.each(EVENT_REQUEST_STATUSES)("renders %s as its label on a status pill", status => {
    const { unmount } = render(<EventRequestStatusBadge status={status} />);
    const pill = screen.getByText(EVENT_REQUEST_STATUS_LABELS[status]);
    expect(pill.getAttribute("data-slot")).toBe("badge");
    unmount();
  });

  it("tells the settled outcomes apart from work in progress by pill", () => {
    const variant = EVENT_REQUEST_STATUS_VARIANTS;
    // Good outcomes share one look, stops share another, and neither is the in-progress amber.
    expect(variant.approved).toBe(variant.confirmed);
    expect(variant.rejected).toBe(variant.cancelled);
    expect(variant.approved).not.toBe(variant.rejected);
    expect(variant.under_review).toBe("progress");
    expect(variant.approved).not.toBe("progress");
    expect(variant.rejected).not.toBe("progress");
  });
});
