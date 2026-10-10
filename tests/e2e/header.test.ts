import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_STAFF_PASSWORD } from "../../scripts/seed";
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
    expect(landing.url()).toMatch(/\/dashboard$/);
    // The menu content renders on the client, so the server markup carries the trigger —
    // `aria-label="Account menu"` — and never the "Sign out" item itself.
    const htmls = await Promise.all([dashboard, landing].map(response => response.text()));
    for (const html of htmls) {
      expect(html).toContain('aria-label="Account menu"');
      expect(html).toContain('aria-label="Notifications"');
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

/**
 * The dashboard is cards only; each role's sections moved to the site header. The header is
 * server-rendered, so the signed-in sections are asserted on the hydrated page per role.
 */
test.describe("Role sections nav", () => {
  test("organiser sees Event requests only", async ({ page }) => {
    const nav = await sectionLinks(page, "jane.doe@example.com");
    await expect(nav.getByRole("link", { name: "Event requests" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Coordination" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Venues" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Venue calendar" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Approved bookings" })).toHaveCount(0);
  });

  test("coordinator sees Coordination, Venues, and Venue calendar", async ({ page }) => {
    const nav = await sectionLinks(page, "coordinator.seed@example.com");
    await expect(nav.getByRole("link", { name: "Event requests" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Coordination" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Venues" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Venue calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approved bookings" })).toHaveCount(0);
  });

  test("venue staff sees Venues, Venue calendar, and Approved bookings", async ({ page }) => {
    const nav = await sectionLinks(page, "venue.staff.seed@example.com");
    await expect(nav.getByRole("link", { name: "Event requests" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Coordination" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Venues" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Venue calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approved bookings" })).toBeVisible();
  });

  test("technical support sees Venues and Venue calendar", async ({ page }) => {
    const nav = await sectionLinks(page, "tech.support.seed@example.com");
    await expect(nav.getByRole("link", { name: "Event requests" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Coordination" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Venues" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Venue calendar" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approved bookings" })).toHaveCount(0);
  });

  test("attendee sees no sections", async ({ page }) => {
    await signInAsSeeded(page, "john.doe@example.com");
    await page.goto("/dashboard");
    await waitForHydration(page);
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCount(0);
  });

  test("visitor sees no sections", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCount(0);
  });
});

async function signInAsSeeded(page: Page, email: string): Promise<void> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function sectionLinks(page: Page, email: string) {
  await signInAsSeeded(page, email);
  await page.goto("/dashboard");
  await waitForHydration(page);
  return page.locator('nav[aria-label="Primary"]');
}
