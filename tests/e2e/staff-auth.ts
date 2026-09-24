import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_STAFF_PASSWORD } from "../../scripts/seed";

const STAFF_ACCOUNTS = {
  event_coordinator: "coordinator.seed@example.com",
  venue_staff: "venue.staff.seed@example.com",
  technical_support_staff: "tech.support.seed@example.com",
} as const;

export type StaffRole = keyof typeof STAFF_ACCOUNTS;

export async function signInWithSeedPassword(page: Page, email: string) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

export async function signInAsStaff(page: Page, role: StaffRole) {
  await signInWithSeedPassword(page, STAFF_ACCOUNTS[role]);
}
