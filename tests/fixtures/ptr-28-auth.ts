import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import * as schema from "#/db/schema";
import type { Database } from "../../scripts/seed";
import type { Role } from "#/features/auth/schema/role";

/** Creates and removes only this test's uniquely named rows. Never resets shared/demo data. */
export async function provisionPtr28Account(database: Database, role: Role) {
  const id = `ptr28-${crypto.randomUUID()}`;
  const email = `${id}@example.test`;
  const password = "Test-Only123!";
  const remove = async () => {
    await database.delete(schema.user).where(eq(schema.user.id, id));
  };
  await database
    .insert(schema.user)
    .values({ id, name: `PTR-28 ${role}`, email, emailVerified: true, role });
  try {
    await database.insert(schema.account).values({
      id: `${id}-credential`,
      accountId: id,
      userId: id,
      providerId: "credential",
      password: await hashPassword(password),
    });
  } catch (error) {
    await remove();
    throw error;
  }
  return { id, email, password, remove };
}
