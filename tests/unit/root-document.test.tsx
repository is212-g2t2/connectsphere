import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RootDocument } from "#/components/layout/root-document";

const themeProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  HeadContent: () => <meta name="head-content" content="stub" />,
  Scripts: () => <script data-testid="scripts" />,
}));

vi.mock("#/components/providers/theme-provider", () => ({
  ThemeProvider: (props: { children?: React.ReactNode } & Record<string, unknown>) => {
    themeProps.current = props;
    return props.children;
  },
}));

vi.mock("#/components/ui/sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

/**
 * The document shell every render is wrapped in, and the one the error and not-found boundaries
 * reuse. Under jsdom React applies `<html>`'s attributes to the real document element and hoists
 * `<head>` nodes into `document.head`, so the shell's contract is asserted there rather than on
 * the test container: the hydration flag E2E waits on, `lang`, the caller's meta and the
 * theme/toaster wiring at the bottom of the body.
 */
describe("RootDocument", () => {
  it("stamps the hydration signal and composes the shell around its children", () => {
    const { container } = render(
      <RootDocument meta={<meta name="robots" content="noindex, nofollow" />}>
        <span>Inside the document</span>
      </RootDocument>
    );

    expect(document.body.dataset.hydrated).toBe("true");
    expect(screen.getByText("Inside the document")).toBeTruthy();
    expect(container.querySelector("script")).not.toBeNull();
    expect(document.documentElement.lang).toBe("en");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
      "noindex, nofollow"
    );
    expect(screen.getByTestId("toaster")).toBeTruthy();
    expect(themeProps.current).toMatchObject({
      defaultTheme: "light",
      storageKey: "connectsphere-theme",
    });
  });
});
