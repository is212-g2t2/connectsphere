import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Page, PageHeader } from "#/components/layout/page";
import { ErrorPage } from "#/components/pages/error";

/**
 * The shared shell implements docs/DESIGN.md §Layout: one centered column at 880px or 1120px,
 * and a 1.6:1 two-column from 860px up when a sidebar is present.
 */
describe("Page", () => {
  it("centers the 880px column by default width and the 1120px wide column", () => {
    const { container: narrow } = render(<Page width="page">Content</Page>);
    expect(narrow.querySelector("main")?.className).toContain("max-w-page");

    const { container: wide } = render(<Page width="wide">Content</Page>);
    expect(wide.querySelector("main")?.className).toContain("max-w-wide");
  });

  it("splits into a 1.6:1 two-column at 860px and up when given a sidebar", () => {
    const { container } = render(
      <Page width="wide" sidebar={<aside>Rail</aside>}>
        Primary
      </Page>
    );

    const split = container.querySelector("main > div");
    expect(split?.className).toContain("split:grid-cols-[1.6fr_1fr]");
    expect(screen.getByText("Rail")).toBeTruthy();
  });

  it("renders children directly, with no split wrapper, when there is no sidebar", () => {
    const { container } = render(<Page width="page">Content</Page>);

    expect(container.querySelector("main > div")).toBeNull();
    expect(container.querySelector("main")?.textContent).toBe("Content");
  });
});

describe("ErrorPage", () => {
  it("renders one main landmark: the shell's, not a nested one", () => {
    const { container } = render(<ErrorPage error={new Error("boom")} />);

    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("renders the documented eyebrow, title, description and actions", () => {
    render(
      <PageHeader
        eyebrow="Dashboard"
        title="Your events"
        description="What needs you now."
        actions={<button type="button">Create a request</button>}
      />
    );

    expect(screen.getByText("Dashboard").className).toContain("eyebrow");
    expect(screen.getByRole("heading", { level: 1, name: "Your events" }).className).toContain(
      "display-h1"
    );
    expect(screen.getByText("What needs you now.").className).toContain("body-sm");
    expect(screen.getByRole("button", { name: "Create a request" })).toBeTruthy();
  });

  it("leaves the optional parts out", () => {
    render(<PageHeader title="Venues" />);

    expect(screen.queryByText("Dashboard")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Venues" })).toBeTruthy();
  });
});
