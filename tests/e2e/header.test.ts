import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";

const password = "HeaderSession123!";

async function signUp(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Header visitor",
      email: `header-${randomUUID()}@example.invalid`,
      password,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * PTR-73: the nav is server-rendered from the session the request already carries.
 *
 * `page.request.get` is the assertion that matters — it reads the server's own response, before
 * a line of client JavaScript runs. Asking the rendered page instead would pass just as well
 * against the `authClient.useSession()` the header used to call, which only answers after
 * hydration and made the account menu pop into a nav that had already painted without it.
 */
test.describe("Header session", () => {
  test("serves the signed-in nav in the server markup", async ({ page }) => {
    await signUp(page);

    // `/` redirects a signed-in request to `/dashboard` (the landing `beforeLoad`), so the
    // request client follows it there — both responses still carry the signed-in nav.
    const [dashboard, landing] = await Promise.all(
      ["/dashboard", "/"].map(url => page.request.get(url))
    );
    expect(landing.url()).toBe("http://localhost:3000/dashboard");
    // The menu content renders on the client, so the server markup carries the trigger —
    // `aria-label="Account menu"` — and never the "Sign out" item itself.
    const htmls = await Promise.all([dashboard, landing].map(response => response.text()));
    for (const html of htmls) {
      expect(html).toContain('aria-label="Account menu"');
      expect(html).toContain('aria-label="Notifications');
    }
  });

  test("leaves it out for a visitor with no session", async ({ page }) => {
    const response = await page.request.get("/");
    const html = await response.text();
    expect(html).not.toContain('aria-label="Account menu"');

    // The refusal also holds after hydration, not only in the server markup.
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  });

  test("hydrates the signed-in nav without a mismatch", async ({ page }) => {
    await signUp(page);

    const mismatches: string[] = [];
    page.on("console", message => {
      if (/hydrat|did not match|server[- ]rendered HTML/i.test(message.text())) {
        mismatches.push(message.text());
      }
    });
    page.on("pageerror", error => {
      if (/hydrat/i.test(error.message)) {
        mismatches.push(error.message);
      }
    });

    await page.goto("/dashboard");
    await waitForHydration(page);

    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Account menu" })).toBeVisible();

    await header.getByRole("button", { name: "Account menu" }).click();
    // The popup mounts in a portal on `document.body`, so the items live outside `header`.
    const menu = page.getByRole("menu");
    await expect(menu.getByText("Settings")).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    expect(mismatches).toEqual([]);
  });

  test("navigates to settings from the account menu", async ({ page }) => {
    await signUp(page);
    await page.goto("/dashboard");
    await waitForHydration(page);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: /account/i })).toBeVisible();
  });
});
