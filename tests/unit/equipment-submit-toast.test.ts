import { describe, expect, test } from "vitest";

import { submitToastMessage } from "#/features/equipment-requests/components/equipment-panel";

describe("submitToastMessage", () => {
  test.each([
    [
      { recipientCount: 0, failedCount: 0 },
      "Equipment requirements submitted. No Technical Support Staff to notify.",
    ],
    [
      { recipientCount: 3, failedCount: 3 },
      "Equipment requirements submitted, but no notifications were delivered.",
    ],
    [
      { recipientCount: 3, failedCount: 1 },
      "Equipment requirements sent to Technical Support; some notifications failed.",
    ],
    [{ recipientCount: 3, failedCount: 0 }, "Equipment requirements sent to Technical Support."],
  ])("%o -> %s", (result, expected) => {
    expect(submitToastMessage(result)).toBe(expected);
  });
});
