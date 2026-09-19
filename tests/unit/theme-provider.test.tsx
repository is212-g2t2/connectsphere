import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "#/components/providers/theme-provider";

const mocks = vi.hoisted(() => ({
  provider: vi.fn<(props: unknown) => void>(),
  useTheme: vi.fn<() => unknown>(),
}));

// `next-themes` reads the document at render; standing it in keeps the assertion on the props
// this wrapper supplies, which is the whole file, and forwards children so they still render.
vi.mock("next-themes", () => ({
  ThemeProvider: (props: { children?: React.ReactNode }) => {
    mocks.provider(props);
    return props.children;
  },
  useTheme: mocks.useTheme,
}));

describe("ThemeProvider", () => {
  it("applies the app's defaults to next-themes and renders children through it", () => {
    render(
      <ThemeProvider>
        <span>Inside the theme</span>
      </ThemeProvider>
    );

    expect(screen.getByText("Inside the theme")).toBeTruthy();
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        attribute: "class",
        defaultTheme: "light",
        storageKey: "connectsphere-theme",
        enableColorScheme: true,
        enableSystem: true,
      })
    );
  });

  it("lets an explicit prop replace a default and forwards the rest through", () => {
    render(
      <ThemeProvider defaultTheme="dark" forcedTheme="dark" nonce="nonce-1">
        <span>Inside</span>
      </ThemeProvider>
    );

    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTheme: "dark",
        forcedTheme: "dark",
        nonce: "nonce-1",
        // Untouched defaults still reach next-themes alongside the overrides.
        attribute: "class",
        storageKey: "connectsphere-theme",
      })
    );
  });

  it("re-exports next-themes' hook rather than wrapping it", () => {
    const state = { theme: "dark", setTheme: vi.fn<() => void>() };
    mocks.useTheme.mockReturnValue(state);

    expect(useTheme()).toBe(state);
  });
});
