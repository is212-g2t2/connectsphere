// oxlint-disable node/no-process-env
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client } from "pg";

/**
 * PTR-133 AC4: migration 0048 backfills the ledger and runs the pre-flight report before it adds
 * `venue_occupancy_no_overlap`. Replay the committed migrations into a separate database: apply
 * everything before the ledger, write data in that shape, then apply 0047 and 0048 in one
 * transaction, as `drizzle-kit migrate` does on a deployed database.
 */

const MIGRATIONS = path.resolve("src/db/drizzle");
const LEDGER_MIGRATION = "0048_venue-occupancy-ledger";
const DATABASE_NAME = `ptr_133_migration_${process.pid}`;

const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
  entries: { tag: string }[];
};
const ledgerIndex = journal.entries.findIndex(entry => entry.tag === LEDGER_MIGRATION);
const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });

describe("migration 0048 backfill and pre-flight (PTR-133 AC4)", () => {
  let admin: Client;
  let client: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${DATABASE_NAME}`);
    await admin.query(`create database ${DATABASE_NAME}`);
    const url = new URL(process.env.DATABASE_URL ?? "");
    url.pathname = `/${DATABASE_NAME}`;
    client = new Client({ connectionString: url.toString() });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await admin.query(`drop database if exists ${DATABASE_NAME}`);
    await admin.end();
  });

  /** Apply migrations `[from, to)` in one transaction, as the Drizzle migrator does. */
  async function apply(from: number, to: number) {
    await client.query("begin");
    try {
      for (const migration of migrations.slice(from, to)) {
        for (const statement of migration.sql) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- statements run in order
          if (statement.trim()) await client.query(statement);
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  async function count(query: string) {
    const result = await client.query<{ count: string }>(query);
    return Number(result.rows[0].count);
  }

  it("stops with every dirty pair listed, then backfills once Venue Staff resolve them", async () => {
    expect(ledgerIndex).toBeGreaterThan(0);
    // Everything before 0047, the generated half of the ledger change.
    await apply(0, ledgerIndex - 1);

    await client.query(`insert into "user" (id, name, email) values ('o', 'Organiser', 'o@x')`);
    await client.query(
      `insert into event_requests (id, organiser_id, event_name) values (1, 'o', 'Event A'), (2, 'o', 'Event B')`
    );
    await client.query(
      `insert into venues (id, name, location, max_capacity, operating_hours, setup_minutes, turnaround_minutes)
       values (1, 'Hall', 'Wing', 50, '{}', 30, 45), (2, 'Annex', 'Wing', 50, '{}', 0, 0)`
    );
    await client.query(
      `insert into venue_requests (id, event_id, venue_id, starts_at, ends_at, status, release_reason) values
         ('r-booked', 1, 1, '2027-01-04 10:00', '2027-01-04 12:00', 'approved', null),
         ('r-before', 2, 1, '2027-01-04 07:00', '2027-01-04 09:00', 'approved', null),
         ('r-pending', 2, 1, '2027-01-04 10:00', '2027-01-04 12:00', 'pending', null),
         ('r-released', 2, 1, '2027-01-04 10:00', '2027-01-04 12:00', 'released', 'Moved')`
    );
    await client.query(
      `insert into venue_holds (id, event_id, venue_id, starts_at, ends_at, status, setup_minutes, turnaround_minutes) values
         ('h-dirty', 2, 1, '2027-01-04 12:30', '2027-01-04 13:00', 'held', 0, 0),
         ('h-kept', 2, 2, '2027-01-04 09:00', '2027-01-04 10:00', 'held', 15, 15),
         ('h-released', 2, 1, '2027-01-04 10:00', '2027-01-04 11:00', 'released', 0, 0)`
    );

    // The old per-table constraints allow both pairs: a booking that overlaps a hold, and two
    // bookings that overlap only once the venue's 30/45 buffers count.
    const failure = apply(ledgerIndex - 1, ledgerIndex + 1);
    await expect(failure).rejects.toThrow(/venue_occupancy_no_overlap pre-flight/);
    const { message } = (await failure.catch((error: unknown) => error)) as Error;
    expect(message).toContain(
      'Hall: booking r-booked for "Event A", 2027-01-04 10:00:00 to 2027-01-04 12:00:00 (setup 30, turnaround 45 minutes) overlaps hold h-dirty for "Event B"'
    );
    expect(message).toContain("booking r-before");
    expect(message.split("\n")).toHaveLength(3);
    // Nothing applied: the ledger is absent and the old constraint is still in place.
    expect(await count(`select count(*) from pg_class where relname = 'venue_occupancy'`)).toBe(0);
    expect(
      await count(`select count(*) from pg_constraint where conname = 'venue_requests_no_overlap'`)
    ).toBe(1);

    // Venue Staff release one side of each pair.
    await client.query(`update venue_holds set status = 'released' where id = 'h-dirty'`);
    await client.query(
      `update venue_requests set status = 'released', release_reason = 'Overlap' where id = 'r-before'`
    );
    await apply(ledgerIndex - 1, ledgerIndex + 1);

    const ledger = await client.query(
      `select venue_id, event_id, venue_request_id, venue_hold_id, setup_minutes, turnaround_minutes, active
       from venue_occupancy order by venue_id`
    );
    expect(ledger.rows).toEqual([
      // A booking takes its venue's buffers at migration time.
      {
        venue_id: 1,
        event_id: 1,
        venue_request_id: "r-booked",
        venue_hold_id: null,
        setup_minutes: 30,
        turnaround_minutes: 45,
        active: true,
      },
      // A hold keeps the buffers it stored when it was placed.
      {
        venue_id: 2,
        event_id: 2,
        venue_request_id: null,
        venue_hold_id: "h-kept",
        setup_minutes: 15,
        turnaround_minutes: 15,
        active: true,
      },
    ]);
    const constraints = await client.query<{ conname: string }>(
      `select conname from pg_constraint where conname like '%no_overlap' order by conname`
    );
    expect(constraints.rows.map(row => row.conname)).toEqual(["venue_occupancy_no_overlap"]);
    // 0048 drops both status wrappers. The drop fails while an index still calls one.
    expect(
      await count(`select count(*) from pg_proc where proname like 'venue_%_occupies_venue'`)
    ).toBe(0);
  });
});
