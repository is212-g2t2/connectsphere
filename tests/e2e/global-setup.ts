// oxlint-disable node/no-process-env, no-console, no-await-in-loop
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { PostgreSqlContainer } from "@testcontainers/postgresql";

import { seed } from "../../scripts/seed";

const APP_URL = "http://localhost:3000";

/** Start the E2E environment in order: PostgreSQL Testcontainer on a random port, migrations, seed,
 * and a production build on port 3000. Playwright runs this before the workers and passes
 * `process.env` changes to them, so setup, tests, and app share one `DATABASE_URL`. Failures throw.
 * Teardown stops the server and container. Removing the container also removes the database.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // PTR-55: the E2E suite drains the notification queue through the cron route, and the server
  // must accept the same token. A real deployment gets it from Secret Manager.
  process.env.CRON_TOKEN ??= "e2e-cron-token";

  // E2E_SKIP_BUILD=1 reuses the existing DATABASE_URL and a server that already runs on
  // :3000. Skip the Testcontainer, migrations, seed, build, and spawn entirely.
  // Reuse shares the server database and may carry dirty state; run without reuse for clean runs.
  if (process.env.E2E_SKIP_BUILD === "1") {
    if (!process.env.DATABASE_URL) {
      throw new Error("E2E_SKIP_BUILD=1 needs DATABASE_URL set to the running server's database.");
    }
    console.info("E2E_SKIP_BUILD=1: reuse the running server and DATABASE_URL.");
    await waitForRunningServer();
    return async () => {};
  }

  console.info("Spinning up PostgreSQL testcontainer for E2E tests...");
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withUsername("postgres")
    .withPassword("postgres")
    .withDatabase("test")
    .start();
  const connectionUri = container.getConnectionUri();
  console.info(`E2E database ready at ${connectionUri}`);

  let server: ChildProcess | undefined;

  try {
    applyMigrations(connectionUri);
    await seed(connectionUri);
    process.env.DATABASE_URL = connectionUri;
    server = await startServer(connectionUri);
  } catch (error) {
    if (server) stopServer(server);
    await container.stop();
    throw error;
  }

  return async () => {
    if (server) stopServer(server);
    await container.stop();
  };
}

function applyMigrations(databaseUrl: string): void {
  execFileSync("bun", ["run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

async function startServer(databaseUrl: string): Promise<ChildProcess> {
  await assertAppPortFree();

  console.info("Building the app for the production server...");
  execFileSync("bun", ["run", "build"], { stdio: "inherit" });

  const server = spawn("bun", ["run", "start"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: "3000" },
    stdio: "inherit",
    // Use a process group on POSIX so teardown can stop the full process tree. Windows uses taskkill /T.
    detached: process.platform !== "win32",
  });
  try {
    await waitForServer(server);
  } catch (error) {
    stopServer(server);
    throw error;
  }
  return server;
}

async function assertAppPortFree(): Promise<void> {
  try {
    await fetch(APP_URL, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(`Something is already serving ${APP_URL}; stop it before running E2E tests.`);
}

/** One poll of the app server. True once it answers below 500. */
async function isServerReady(): Promise<boolean> {
  try {
    const response = await fetch(APP_URL, { signal: AbortSignal.timeout(1_000) });
    return response.status < 500;
  } catch {
    // The server does not accept connections yet.
    return false;
  }
}

async function waitForServer(server: ChildProcess): Promise<void> {
  let spawnError: Error | undefined;
  server.on("error", error => {
    spawnError = error;
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early with code ${server.exitCode}`);
    }
    if (await isServerReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Production server did not answer at ${APP_URL} within 30s`);
}

/** Wait for a server that already runs (E2E_SKIP_BUILD=1). No child process to watch. */
async function waitForRunningServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isServerReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`No running server answered at ${APP_URL} within 30s`);
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // The process exited. Nothing remains to stop.
    }
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
}
