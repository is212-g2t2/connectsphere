import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test("should load landing page and show content", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("http://localhost:3000/");
    await expect(
      page.getByText(
        "Event planning and venue booking for organisers, coordinators, venue staff and technical support."
      )
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /create an account/i })).toBeVisible();
  });
});
