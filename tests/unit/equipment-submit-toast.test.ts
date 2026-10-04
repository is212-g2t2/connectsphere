import { describe, expect, test } from "vitest";

import { submitToastMessage } from "#/features/equipment-requests/components/equipment-panel";

describe("submitToastMessage", () => {
  // Delivery is the worker's job now, so the only branches left are whether anyone was queued.
  test.each([
    [
      { recipientCount: 0 },
      "Equipment requirements submitted. No Technical Support Staff to notify.",
    ],
    [{ recipientCount: 3 }, "Equipment requirements sent to Technical Support."],
  ])("%o -> %s", (result, expected) => {
    expect(submitToastMessage(result)).toBe(expected);
  });
});
