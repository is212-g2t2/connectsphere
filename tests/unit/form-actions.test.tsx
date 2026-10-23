// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FormErrorSummary,
  StickyFormActions,
  focusFirstInvalid,
} from "#/components/ui/form-actions";

describe("FormErrorSummary", () => {
  it("renders nothing without errors", () => {
    const { container } = render(<FormErrorSummary errors={[]} />);

    expect(container.firstElementChild).toBeNull();
  });

  it("announces the errors and anchors each entry to its field", () => {
    render(
      <>
        <form>
          <input id="venue-name" />
          <input id="venue-capacity" />
        </form>
        <FormErrorSummary
          errors={[
            { fieldId: "venue-name", label: "Name", message: "Enter the venue's name" },
            { fieldId: "venue-capacity", label: "Capacity", message: "Enter a capacity" },
          ]}
        />
      </>
    );

    const summary = screen.getByRole("alert");
    expect(summary.textContent).toContain("There are 2 problems");
    expect(
      screen.getByRole("link", { name: "Name: Enter the venue's name" }).getAttribute("href")
    ).toBe("#venue-name");
    expect(
      screen.getByRole("link", { name: "Capacity: Enter a capacity" }).getAttribute("href")
    ).toBe("#venue-capacity");
  });
});

describe("StickyFormActions", () => {
  it("sticks to the viewport bottom with safe-area padding", () => {
    const { container } = render(
      <StickyFormActions>
        <button type="submit">Save venue</button>
      </StickyFormActions>
    );

    const actions = container.firstElementChild;
    expect(actions?.className).toContain("sticky");
    expect(actions?.className).toContain("bottom-0");
    expect(actions?.className).toContain("border-t");
    expect(actions?.className).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(screen.getByRole("button", { name: "Save venue" })).toBeTruthy();
  });
});

describe("focusFirstInvalid", () => {
  it("moves focus to the first invalid field", () => {
    render(
      <>
        <input id="venue-name" />
        <input id="venue-capacity" />
      </>
    );

    focusFirstInvalid([{ fieldId: "venue-capacity" }, { fieldId: "venue-name" }]);

    expect(document.activeElement).toBe(document.getElementById("venue-capacity"));
  });

  it("ignores an empty list and a missing field", () => {
    render(<input id="venue-name" />);

    focusFirstInvalid([]);
    expect(document.activeElement).toBe(document.body);

    focusFirstInvalid([{ fieldId: "no-such-field" }]);
    expect(document.activeElement).toBe(document.body);
  });
});
