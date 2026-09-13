// oxlint-disable node/no-process-env
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { provisionPtr28Account } from "../fixtures/ptr-28-auth";
import type { Role } from "#/features/auth/schema/role";
import type { OperatingHours } from "#/features/venues/schema";

const { pool, requestState } = await vi.hoisted(async () => {
  const { Pool } = await import("pg");
  return {
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
    requestState: { current: new Request("http://localhost:3000") },
  };
});
vi.mock("#/db", async () => {
  const { drizzle: drizzleNode } = await import("drizzle-orm/node-postgres");
  return { client: pool, db: drizzleNode(pool, { schema: await import("#/db/schema") }) };
});
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => requestState.current }));
vi.mock("#/lib/mailer", () => ({
  createMailer: () => null,
  getMailer: () => null,
  sendEmail: async () => ({ id: "test-only" }),
}));

const { auth } = await import("#/lib/auth");
const { Route: scheduleRoute } = await import("#/routes/api/venue-availability");
const { Route: venuesRoute } = await import("#/routes/api/venue-availability.venues");
const database = drizzle(pool, { schema });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(remove => remove()));
});
afterAll(async () => {
  await pool.end();
});

const selection = "venueId=VA&startDate=2026-10-05&endDate=2026-10-07";
const entries = [
  { name: "schedule", path: `/api/venue-availability?${selection}`, route: scheduleRoute },
  { name: "venue list", path: "/api/venue-availability/venues", route: venuesRoute },
];

async function signIn(role: Role) {
  const account = await provisionPtr28Account(database, role);
  cleanups.push(account.remove);
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password }),
    })
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map(value => value.split(";")[0])
    .join("; ");
  expect(cookie).toBeTruthy();
  return cookie;
}

async function request(entry: (typeof entries)[number], cookie = "", query = entry.path) {
  requestState.current = new Request(`http://localhost:3000${query}`, { headers: { cookie } });
  const handlers = entry.route.options.server?.handlers as
    | { GET?: () => Promise<Response> }
    | undefined;
  const handler = handlers?.GET;
  if (!handler) throw new Error("Availability GET handler is missing");
  return handler();
}

type VenueListItem = { id: string; name: string };
type AvailabilityPeriod = { startsAt: string; endsAt: string };
type OccupiedPeriod = AvailabilityPeriod & {
  id: string;
  state: "confirmed" | "blocked";
  visibleStart: string;
  visibleEnd: string;
};
type ScheduleResponse = {
  venue: VenueListItem;
  startDate: string;
  endDate: string;
  timeZone: string | null;
  available: AvailabilityPeriod[];
  occupied: OccupiedPeriod[];
};

const openEveryDay = (): OperatingHours => ({
  mon: { opens: "00:00", closes: "23:59" },
  tue: { opens: "00:00", closes: "23:59" },
  wed: { opens: "00:00", closes: "23:59" },
  thu: { opens: "00:00", closes: "23:59" },
  fri: { opens: "00:00", closes: "23:59" },
  sat: { opens: "00:00", closes: "23:59" },
  sun: { opens: "00:00", closes: "23:59" },
});

const closedEveryDay = (): OperatingHours => ({
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
});

function localIso(date: string, time: string): string {
  return `${date}T${time}:00`;
}

function localDatabaseTimestamp(date: string, time: string): string {
  return `${date} ${time}:00`;
}

async function createVenue(operatingHours: OperatingHours, label = "fixture") {
  const name = `PTR-28 ${label} ${crypto.randomUUID()}`;
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name,
      location: "PTR-28 integration fixture",
      maxCapacity: 100,
      facilities: [],
      accessibilityFeatures: [],
      supportedLayouts: [],
      operatingHours,
    })
    .returning({ id: schema.venues.id, name: schema.venues.name });
  if (!venue) throw new Error("Venue fixture was not created");
  cleanups.push(async () => {
    await database.delete(schema.venues).where(eq(schema.venues.id, venue.id));
  });
  return venue;
}

async function createBlock(venueId: number, startsAt: string, endsAt: string, reason: string) {
  const [block] = await database
    .insert(schema.venueUnavailability)
    .values({ venueId, startsAt, endsAt, reason })
    .returning({ id: schema.venueUnavailability.id });
  if (!block) throw new Error("Unavailability fixture was not created");
  return block;
}

async function requestSchedule(
  cookie: string,
  venueId: string,
  startDate = "2027-03-01",
  endDate = "2027-03-01"
) {
  const query = new URLSearchParams({ venueId, startDate, endDate });
  return request(entries[0], cookie, `/api/venue-availability?${query}`);
}

async function readSchedule(response: Response): Promise<ScheduleResponse> {
  return (await response.json()) as ScheduleResponse;
}

describe.each(entries)("PTR-28 real-auth route handler: $name (isolated PostgreSQL)", entry => {
  it.each([
    { variant: "A", role: "attendee" as const },
    { variant: "B", role: "event_organiser" as const },
  ])(
    "[PTR-28-TC14-$variant][AC5] rejects the external session with 403 and no data",
    async ({ role }) => {
      const response = await request(entry, await signIn(role));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  );
  it("[PTR-28-TC18-B][AC1][AC5] returns 401 without a session", async () => {
    const response = await request(entry);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("PTR-28 request validation at the real-auth schedule handler", () => {
  it.each([
    { variant: "A", query: "startDate=2026-10-05&endDate=2026-10-07", error: "Select a venue" },
    {
      variant: "C",
      query: "venueId=VA&startDate=2026-99-99&endDate=2026-10-07",
      error: "Enter a valid start date",
    },
    {
      variant: "D",
      query: "venueId=VA&startDate=2026-10-07&endDate=2026-10-05",
      error: "End date must be on or after start date",
    },
    { variant: "E", query: "venueId=VA&startDate=2026-10-05", error: "Enter a valid end date" },
  ])(
    "[PTR-28-TC15-$variant][AC1] returns a plain 400 validation message",
    async ({ query, error }) => {
      const response = await request(
        entries[0],
        await signIn("event_coordinator"),
        `/api/venue-availability?${query}`
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
    }
  );
});

describe("PTR-28 database-backed venue and availability reads", () => {
  it("[PTR-28-TC01-DB][AC1] lists a fixture venue with its generated integer ID as a string", async () => {
    const venue = await createVenue(openEveryDay(), "listing");
    const response = await request(entries[1], await signIn("event_coordinator"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as VenueListItem[];
    const listed = body.find(item => item.name === venue.name);
    expect(listed).toEqual({ id: String(venue.id), name: venue.name });
    expect(listed && Number(listed.id)).toBe(venue.id);
  });

  it.each([
    { label: "non-numeric", venueId: "not-a-number" },
    { label: "decimal", venueId: "1.5" },
    { label: "zero", venueId: "0" },
    { label: "negative", venueId: "-1" },
    { label: "above the PostgreSQL integer range", venueId: "2147483648" },
  ])(
    "[PTR-28-TC15-ID-$label][AC1] rejects a malformed or out-of-range numeric venue ID",
    async ({ venueId }) => {
      const response = await requestSchedule(
        await signIn("event_coordinator"),
        venueId,
        "2027-03-01",
        "2027-03-01"
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: unknown };
      expect(typeof body.error).toBe("string");
      expect(body.error).toBeTruthy();
    }
  );

  it("[PTR-28-TC15-B-DB][AC1][AC2] distinguishes an unknown numeric venue from an existing empty venue", async () => {
    const emptyVenue = await createVenue(openEveryDay(), "empty");
    const cookie = await signIn("event_coordinator");

    const emptyResponse = await requestSchedule(cookie, String(emptyVenue.id));
    expect(emptyResponse.status).toBe(200);
    const emptyBody = await readSchedule(emptyResponse);
    expect(emptyBody.venue).toEqual({ id: String(emptyVenue.id), name: emptyVenue.name });
    expect(emptyBody.occupied).toEqual([]);
    expect(emptyBody.available.length).toBeGreaterThan(0);

    const unknownResponse = await requestSchedule(cookie, "2147483647");
    expect(unknownResponse.status).toBe(404);
    const unknownBody = (await unknownResponse.json()) as { error?: unknown };
    expect(typeof unknownBody.error).toBe("string");
    expect(unknownBody.error).toBeTruthy();
  });

  it("[PTR-28-TC09-DB][PTR-28-TC10-DB][PTR-28-TC11-DB][AC1][AC4] returns only independent blocks overlapping the selected venue and range", async () => {
    const venue = await createVenue(openEveryDay(), "overlap");
    const otherVenue = await createVenue(openEveryDay(), "other-venue");
    const overlappingAtStart = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-02-28", "23:00"),
      localDatabaseTimestamp("2027-03-01", "01:00"),
      "starts before range"
    );
    const overlappingInside = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-03-01", "12:00"),
      localDatabaseTimestamp("2027-03-01", "13:00"),
      "inside range"
    );
    const overlappingAtEnd = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-03-02", "23:00"),
      localDatabaseTimestamp("2027-03-03", "01:00"),
      "ends after range"
    );
    const endingAtRangeStart = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-02-28", "23:00"),
      localDatabaseTimestamp("2027-03-01", "00:00"),
      "ends at range start"
    );
    const startingAtRangeEnd = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-03-03", "00:00"),
      localDatabaseTimestamp("2027-03-03", "01:00"),
      "starts at range end"
    );
    const otherVenueBlock = await createBlock(
      otherVenue.id,
      localDatabaseTimestamp("2027-03-01", "12:00"),
      localDatabaseTimestamp("2027-03-01", "13:00"),
      "different venue"
    );
    const response = await requestSchedule(
      await signIn("venue_staff"),
      String(venue.id),
      "2027-03-01",
      "2027-03-02"
    );

    expect(response.status).toBe(200);
    const body = await readSchedule(response);
    const occupiedIds = body.occupied.map(period => period.id);
    expect(occupiedIds).toEqual(
      expect.arrayContaining([
        String(overlappingAtStart.id),
        String(overlappingInside.id),
        String(overlappingAtEnd.id),
      ])
    );
    expect(occupiedIds).toHaveLength(3);
    expect(occupiedIds).not.toContain(String(endingAtRangeStart.id));
    expect(occupiedIds).not.toContain(String(startingAtRangeEnd.id));
    expect(occupiedIds).not.toContain(String(otherVenueBlock.id));
    expect(body.occupied.every(period => period.state === "blocked")).toBe(true);
  });

  it("[PTR-28-TC16-DB][AC2] creates openings only for non-null operating-hours days with exact local boundaries", async () => {
    const venue = await createVenue(
      {
        mon: { opens: "09:00", closes: "17:00" },
        tue: null,
        wed: { opens: "10:00", closes: "12:00" },
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      },
      "hours"
    );
    const response = await requestSchedule(
      await signIn("event_coordinator"),
      String(venue.id),
      "2027-03-01",
      "2027-03-03"
    );

    expect(response.status).toBe(200);
    const body = await readSchedule(response);
    expect(body.occupied).toEqual([]);
    expect(body.available).toEqual([
      { startsAt: localIso("2027-03-01", "09:00"), endsAt: localIso("2027-03-01", "17:00") },
      { startsAt: localIso("2027-03-03", "10:00"), endsAt: localIso("2027-03-03", "12:00") },
    ]);
  });

  it("[PTR-28-TC11-DB][AC2][AC4] represents recorded local wall-clock periods without inventing an offset or timezone", async () => {
    const venue = await createVenue(
      { ...closedEveryDay(), mon: { opens: "08:00", closes: "18:00" } },
      "floating-time"
    );
    const block = await createBlock(
      venue.id,
      localDatabaseTimestamp("2027-03-01", "10:00"),
      localDatabaseTimestamp("2027-03-01", "12:00"),
      "floating local period"
    );
    const response = await requestSchedule(
      await signIn("venue_staff"),
      String(venue.id),
      "2027-03-01",
      "2027-03-01"
    );

    expect(response.status).toBe(200);
    const body = await readSchedule(response);
    expect(body.timeZone).toBeNull();
    const occupied = body.occupied.find(period => period.id === String(block.id));
    expect(occupied).toBeDefined();
    for (const value of [
      occupied?.startsAt,
      occupied?.endsAt,
      occupied?.visibleStart,
      occupied?.visibleEnd,
    ]) {
      expect(value).toMatch(/^2027-03-01T(?:10:00:00|12:00:00)(?:\.000)?$/);
      expect(value).not.toMatch(/[zZ]|[+-]\d\d(?::?\d\d)?$/);
    }
    expect(occupied).toMatchObject({
      startsAt: expect.stringMatching(/^2027-03-01T10:00:00(?:\.000)?$/),
      endsAt: expect.stringMatching(/^2027-03-01T12:00:00(?:\.000)?$/),
      visibleStart: expect.stringMatching(/^2027-03-01T10:00:00(?:\.000)?$/),
      visibleEnd: expect.stringMatching(/^2027-03-01T12:00:00(?:\.000)?$/),
    });
  });

  it("[PTR-26-AC5][PTR-28-DB][AC1] reads a saved venue edit on the next availability request", async () => {
    const venue = await createVenue(
      { ...closedEveryDay(), mon: { opens: "09:00", closes: "10:00" } },
      "edit"
    );
    const cookie = await signIn("event_coordinator");
    const beforeResponse = await requestSchedule(cookie, String(venue.id));
    expect(beforeResponse.status).toBe(200);
    const before = await readSchedule(beforeResponse);
    expect(before.venue).toEqual({ id: String(venue.id), name: venue.name });
    expect(before.available).toEqual([
      { startsAt: localIso("2027-03-01", "09:00"), endsAt: localIso("2027-03-01", "10:00") },
    ]);

    const editedName = `PTR-28 saved edit ${crypto.randomUUID()}`;
    await database
      .update(schema.venues)
      .set({
        name: editedName,
        operatingHours: { ...closedEveryDay(), mon: { opens: "14:00", closes: "16:00" } },
      })
      .where(eq(schema.venues.id, venue.id));

    const afterResponse = await requestSchedule(cookie, String(venue.id));
    expect(afterResponse.status).toBe(200);
    const after = await readSchedule(afterResponse);
    expect(after.venue).toEqual({ id: String(venue.id), name: editedName });
    expect(after.available).toEqual([
      { startsAt: localIso("2027-03-01", "14:00"), endsAt: localIso("2027-03-01", "16:00") },
    ]);
  });
});
