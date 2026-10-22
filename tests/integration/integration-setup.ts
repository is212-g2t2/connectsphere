// oxlint-disable node/no-process-env
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { seed } from "../../scripts/seed";

let postgres: StartedPostgreSqlContainer | undefined;
let storage: StartedTestContainer | undefined;

/** Local S3 identity for the test bucket. The values never leave the test run. */
const STORAGE_ACCESS_KEY_ID = "test-access-key";
const STORAGE_SECRET_ACCESS_KEY = "test-secret-key-for-attachments";

/**
 * Start a `postgres:18-alpine` Testcontainer, apply committed migrations, seed test data,
 * and start one SeaweedFS container as the attachment bucket. SeaweedFS creates the test
 * bucket on the first write (`-s3.autoCreateBucket`), so the setup stores no bucket.
 */
export async function setup(): Promise<void> {
  if (postgres) {
    return;
  }

  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  const connectionUri = postgres.getConnectionUri();

  process.env.DATABASE_URL = connectionUri;

  const drizzleBin = path.resolve(process.cwd(), "node_modules/drizzle-kit/bin.cjs");
  execFileSync(process.execPath, [drizzleBin, "migrate"], {
    env: {
      ...process.env,
      DATABASE_URL: connectionUri,
    },
    stdio: "inherit",
  });

  await seed(connectionUri);

  storage = await new GenericContainer("chrislusf/seaweedfs:4.48")
    .withCommand([
      "server",
      "-dir=/data",
      "-master.volumeSizeLimitMB=256",
      "-volume.max=0",
      "-s3",
      "-filer",
      "-s3.port=8333",
      "-s3.config=/etc/seaweedfs/s3.json",
      "-s3.autoCreateBucket=true",
    ])
    .withCopyContentToContainer([
      {
        content: JSON.stringify({
          identities: [
            {
              name: "test",
              credentials: [
                { accessKey: STORAGE_ACCESS_KEY_ID, secretKey: STORAGE_SECRET_ACCESS_KEY },
              ],
              actions: ["Admin", "Read", "Write", "List", "Tagging", "ReadAcp", "WriteAcp"],
            },
          ],
        }),
        target: "/etc/seaweedfs/s3.json",
      },
    ])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forLogMessage(/Start Seaweed S3 API Server/))
    .withStartupTimeout(120_000)
    .start();

  process.env.STORAGE_BUCKET = "connectsphere-attachments-test";
  process.env.STORAGE_ENDPOINT = `http://${storage.getHost()}:${storage.getMappedPort(8333)}`;
  process.env.STORAGE_REGION = "auto";
  process.env.STORAGE_ACCESS_KEY_ID = STORAGE_ACCESS_KEY_ID;
  process.env.STORAGE_SECRET_ACCESS_KEY = STORAGE_SECRET_ACCESS_KEY;
}

/**
 * Stop the SeaweedFS and PostgreSQL Testcontainers.
 */
export async function teardown(): Promise<void> {
  if (storage) {
    await storage.stop();
    storage = undefined;
  }
  if (postgres) {
    await postgres.stop();
    postgres = undefined;
  }
}

/**
 * Vitest global setup function.
 */
export default async function (): Promise<() => Promise<void>> {
  await setup();
  return async () => {
    await teardown();
  };
}
