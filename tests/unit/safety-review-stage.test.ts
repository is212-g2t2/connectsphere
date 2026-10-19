import { describe, expect, it } from "vitest";

import {
  safetyReviewStageLabel,
  SAFETY_REVIEW_OUT_OF_DATE_LABEL,
} from "#/features/safety-reviews/schema";

/** PTR-158 AC2: the stage an Organiser or Coordinator reads instead of the plain status. */
describe("safetyReviewStageLabel", () => {
  it.each(["approved", "planning"] as const)(
    "names each current review state on a %s event",
    status => {
      expect(safetyReviewStageLabel(status, { state: "pending", current: true })).toBe(
        "Awaiting safety review"
      );
      expect(safetyReviewStageLabel(status, { state: "approved", current: true })).toBe(
        "Safety approved"
      );
      expect(safetyReviewStageLabel(status, { state: "changes_requested", current: true })).toBe(
        "Safety changes requested"
      );
      expect(safetyReviewStageLabel(status, { state: "rejected", current: true })).toBe(
        "Safety rejected"
      );
    }
  );

  it.each(["pending", "approved", "changes_requested", "rejected"] as const)(
    "reads a %s review that no longer covers the arrangements as out of date",
    state => {
      expect(safetyReviewStageLabel("planning", { state, current: false })).toBe(
        SAFETY_REVIEW_OUT_OF_DATE_LABEL
      );
    }
  );

  it("keeps the plain status before the first review", () => {
    expect(safetyReviewStageLabel("approved", null)).toBeNull();
    expect(safetyReviewStageLabel("planning", undefined)).toBeNull();
  });

  it.each(["confirmed", "completed", "cancelled", "rejected", "submitted"] as const)(
    "keeps the plain status on a %s event",
    status => {
      expect(safetyReviewStageLabel(status, { state: "approved", current: true })).toBeNull();
    }
  );
});
