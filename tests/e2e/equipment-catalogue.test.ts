import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { waitForHydration } from "./hydration";
import { signInAsStaff, signInWithSeedPassword } from "./staff-auth";

test.describe("Equipment catalogue", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await page.goto("/equipment-types");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects a Coordinator to the dashboard", async ({ page }) => {
    await signInWithSeedPassword(page, "coordinator.seed@example.com");
    await page.goto("/equipment-types");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("lets Technical Support add a type", async ({ page }) => {
    await signInAsStaff(page, "technical_support_staff");
    await page.goto("/equipment-types");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Equipment catalogue" })).toBeVisible();

    const name = `Playwright Type ${randomUUID().slice(0, 8)}`;
    await page.getByRole("button", { name: "Add type" }).click();
    await page.getByLabel("Type name (required)").fill(name);
    await page.getByLabel("Quantity held (required)").fill("6");
    await page.getByRole("button", { name: "Add type", exact: true }).last().click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });
});
