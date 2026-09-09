// oxlint-disable node/no-process-env, no-console
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import net from "node:net";
import { execFileSync } from "node:child_process";

let container: StartedPostgreSqlContainer | undefined;

function isPortReachable(host: string, port: number, timeout = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port, timeout });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  let connectionUri = process.env.DATABASE_URL;
  let alreadyRunning = false;

  if (connectionUri) {
    try {
      const url = new URL(connectionUri);
      alreadyRunning = await isPortReachable(url.hostname, parseInt(url.port || "5432", 10));
    } catch {
      alreadyRunning = false;
    }
  }

  if (!alreadyRunning) {
    try {
      console.info("Spinning up PostgreSQL testcontainer for E2E tests...");
      container = await new PostgreSqlContainer("postgres:18-alpine")
        .withUsername("postgres")
        .withPassword("postgres")
        .withDatabase("app")
        .withExposedPorts({ host: 5432, container: 5432 })
        .start();
      connectionUri = "postgresql://postgres:postgres@localhost:5432/app";
      process.env.DATABASE_URL = connectionUri;
      console.info("PostgreSQL testcontainer ready:", connectionUri);
    } catch (err: unknown) {
      console.warn("Could not start PostgreSQL testcontainer (Docker may not be running):", err);
    }
  }

  if (connectionUri) {
    try {
      execFileSync("bun", ["run", "db:migrate"], {
        env: {
          ...process.env,
          DATABASE_URL: connectionUri,
        },
        stdio: "pipe",
      });
    } catch (err: unknown) {
      console.warn("Migration execution warning in E2E setup:", err);
    }
  }

  return async () => {
    if (container) {
      console.info("Stopping PostgreSQL testcontainer...");
      await container.stop();
      container = undefined;
    }
  };
}
