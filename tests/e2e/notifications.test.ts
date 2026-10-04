// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { waitForHydration } from "./hydration";
import { registerAccount } from "./register";

const PASSWORD = "Notification123!";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterAll(async () => {
  await pool.end();
});

/**
 * PTR-55: the signed-in user opens their notifications and sees theirs, newest first, with what
 * happened and when; opening one leads to the request it concerns; a notification whose event
 * they are not connected to shows the neutral line and no event data.
 */
test("[PTR-55] reads notifications, follows one, and sees no data for an event out of reach", async ({
  page,
}) => {
  const otherOrganiserId = randomUUID();
  const eventIds: number[] = [];
  let readerId: string | undefined;

  try {
    const reader = await registerAccount(database, page, {
      role: "event_organiser",
      name: "PTR-55 Reader",
      password: PASSWORD,
    });
    readerId = reader.id;

    await database.insert(schema.user).values({
      id: otherOrganiserId,
      name: "PTR-55 Other Organiser",
      email: `${otherOrganiserId}@example.invalid`,
      role: "event_organiser",
    });

    const [reachableEvent, unreachableEvent] = await database
      .insert(schema.eventRequests)
      .values([
        {
          organiserId: reader.id,
          eventName: "PTR-55 Reachable Gala",
          status: "submitted",
          submittedAt: new Date(),
        },
        {
          organiserId: otherOrganiserId,
          eventName: "PTR-55 Unreachable Gala",
          status: "submitted",
          submittedAt: new Date(),
        },
      ])
      .returning({ id: schema.eventRequests.id });
    eventIds.push(reachableEvent.id, unreachableEvent.id);

    await database.insert(schema.notifications).values([
      {
        recipientId: reader.id,
        eventRequestId: unreachableEvent.id,
        kind: "event_confirmed",
        payload: {
          eventName: "PTR-55 Unreachable Gala",
          venueName: "Elsewhere",
          startsAt: "2037-08-01 09:00:00",
          endsAt: "2037-08-01 12:00:00",
          equipment: [],
        },
        createdAt: new Date("2037-07-01T00:00:00Z"),
      },
      {
        recipientId: reader.id,
        eventRequestId: reachableEvent.id,
        kind: "event_confirmed",
        payload: {
          eventName: "PTR-55 Reachable Gala",
          venueName: "PTR-55 Hall",
          startsAt: "2037-09-01 09:00:00",
          endsAt: "2037-09-01 12:00:00",
          equipment: [],
        },
        createdAt: new Date("2037-07-02T00:00:00Z"),
      },
    ]);

    await page.goto("/notifications");
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    const items = page.getByRole("listitem");
    await expect(items).toHaveCount(2);
    // Newest first: the later confirmation sits above the earlier, unreachable one.
    await expect(items.first()).toContainText("Event confirmed: PTR-55 Reachable Gala");
    await expect(items.last()).toContainText("This notification is no longer available.");
    // The unreachable event's data is nowhere on the page.
    await expect(page.getByText("PTR-55 Unreachable Gala")).toHaveCount(0);
    await expect(page.getByText("Elsewhere")).toHaveCount(0);

    await items.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/event-requests/${reachableEvent.id}$`));
  } finally {
    await database
      .delete(schema.notifications)
      .where(inArray(schema.notifications.eventRequestId, eventIds));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
    await database.delete(schema.user).where(eq(schema.user.id, otherOrganiserId));
    if (readerId !== undefined) {
      await database.delete(schema.user).where(eq(schema.user.id, readerId));
    }
  }
});
