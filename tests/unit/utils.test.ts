import { describe, expect, test } from "vitest";

import { cn } from "#/lib/utils";

describe("cn", () => {
  test("merges conditional classes and resolves Tailwind conflicts", () => {
    const shouldHide = false;

    expect(cn("px-2", shouldHide && "hidden", "px-4", ["text-sm", "text-lg"])).toBe("px-4 text-lg");
  });
});
