// oxlint-disable node/no-process-env
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { seed } from "../../scripts/seed";

let container: StartedPostgreSqlContainer | undefined;

/**
 * Spins up a postgres:18-alpine testcontainer, pushes the database schema, and seeds test data.
 */
export async function setup(): Promise<void> {
  if (container) {
    return;
  }

  container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const connectionUri = container.getConnectionUri();

  process.env.DATABASE_URL = connectionUri;

  const drizzleBin = path.resolve(process.cwd(), "node_modules/drizzle-kit/bin.cjs");
  execFileSync(process.execPath, [drizzleBin, "push", "--force"], {
    env: {
      ...process.env,
      DATABASE_URL: connectionUri,
    },
    stdio: "inherit",
  });

  await seed(connectionUri);
}

/**
 * Stops the running PostgreSQL testcontainer.
 */
export async function teardown(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
}

/**
 * Default export for Vitest globalSetup.
 */
export default async function (): Promise<() => Promise<void>> {
  await setup();
  return async () => {
    await teardown();
  };
}
