import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import * as Sentry from "@sentry/tanstackstart-react";
import { describe, expect, it, vi } from "vitest";

import { Page, PageHeader } from "#/components/layout/page";
import { ErrorPage, RootErrorPage, RootNotFoundPage } from "#/components/pages/error";

vi.mock("@sentry/tanstackstart-react", () => ({
  captureException: vi.fn<(error: unknown) => void>(),
}));

// The boundaries render the real document shell; this stands it in so the assertions stay on the
// Sentry reporting and the error copy rather than on `<html>` nesting.
vi.mock("#/components/layout/root-document", () => ({
  RootDocument: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

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

describe("RootErrorPage", () => {
  it("reports the failure to Sentry and lets the reset callback retry", async () => {
    const user = userEvent.setup();
    const reset = vi.fn<() => void>();
    const error = new Error("kaboom");

    render(<RootErrorPage error={error} reset={reset} />);

    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledWith(error));
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText("kaboom")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reports the failure during SSR too, where no effect can run", () => {
    const error = new Error("ssr-kaboom");

    // `renderToString` reaches the branch a browser render cannot: without a window the capture
    // cannot wait for the effect, so the page reports synchronously.
    vi.stubGlobal("window", undefined);
    try {
      renderToString(<RootErrorPage error={error} reset={vi.fn<() => void>()} />);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});

describe("RootNotFoundPage", () => {
  it("shows the 404 copy without reporting a missing route", () => {
    render(<RootNotFoundPage />);

    expect(screen.getByRole("heading", { name: "404 - Not Found" })).toBeTruthy();
    expect(screen.getByText("The page you are looking for does not exist.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(Sentry.captureException).not.toHaveBeenCalled();
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
