import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../src/db/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Register an account through the API. Internal roles are not self-assignable, so register a
 * coordinator as an organiser and promote directly. Sign out and back in; the session then
 * carries the role. Specs that need their own account share this helper.
 */
export async function registerAccount(
  database: Database,
  page: Page,
  options: { role: "event_organiser" | "event_coordinator"; name: string; password: string }
) {
  const email = `${options.role}-${randomUUID()}@example.invalid`;
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: { name: options.name, email, password: options.password, role: "event_organiser" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const [account] = await database.select().from(schema.user).where(eq(schema.user.email, email));

  if (options.role === "event_coordinator") {
    await database
      .update(schema.user)
      .set({ role: options.role })
      .where(eq(schema.user.id, account.id));
    const logout = await page.request.post("/api/auth/sign-out", {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(logout.ok(), await logout.text()).toBe(true);
    const login = await page.request.post("/api/auth/sign-in/email", {
      headers: { Origin: "http://localhost:3000" },
      data: { email, password: options.password },
    });
    expect(login.ok(), await login.text()).toBe(true);
  }

  return account;
}
