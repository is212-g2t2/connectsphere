import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Wait for the root route's hydration effect before typing into a controlled input or clicking
 * server-rendered markup. React ignores actions on inert HTML. For assertions, query the element
 * directly. Playwright waits for it, and an idle network does not prove hydration finished.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-hydrated", "true");
}
