// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { getCurrentUser, listAccounts, requireSession } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  assignEventRequest,
  decideEventRequest,
  getCoordinationRequest,
  listAssignedEventRequests,
  listCoordinators,
  takeUpEventRequestForReview,
} from "#/features/coordination/server-fns";
import { handleDeleteEventRequestDraft } from "#/features/event-requests/drafts.server";
import {
  ATTENDANCE_MESSAGE,
  EVENT_REQUEST_DELETE_REFUSAL,
  EVENT_REQUEST_ID_MESSAGE,
} from "#/features/event-requests/schema";
import {
  deleteEventRequestDraft,
  getEventRequest,
  getEventRequestDraft,
  listEventRequests,
  listUnassignedEventRequests,
  requireEventRequestCreate,
  saveEventRequestDraft,
  submitEventRequest,
} from "#/features/event-requests/server-fns";
import { listEvents } from "#/features/events/server-fns";
import { handleSaveVenue } from "#/features/venues/records.server";
import {
  AVAILABILITY_ORDER_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  NAME_REQUIRED_MESSAGE,
  VENUE_ID_MESSAGE,
} from "#/features/venues/schema";
import {
  getVenue,
  getVenueAvailability,
  listVenues,
  saveVenue,
  searchVenues,
} from "#/features/venues/server-fns";
import { auth } from "#/lib/auth.server";

/** A payload the venue validator accepts, so the allow path runs the whole chain. */
const venueRecord = {
  name: "New room",
  location: "Level 3",
  maxCapacity: 10,
  operatingHours: DEFAULT_OPERATING_HOURS,
};

/** A selection the availability validator accepts, for the same reason as `venueRecord`. */
const availabilitySelection = {
  venueId: 1,
  startDate: "2026-01-05",
  endDate: "2026-01-09",
};

/**
 * PTR-69 at the server-function boundary: `__executeServer` is the entry the HTTP route calls,
 * so each case below runs the real function's own middleware chain — not a reconstruction of it —
 * and can catch a function wired to the wrong guard. The request and the session are the two
 * things the runtime supplies, so they are the two things mocked here.
 *
 * On a refusal the middleware short-circuits: `error` is the status `Response`, and the handler
 * below it never runs (the uncompiled test module does not carry a handler body at all — TanStack
 * Start's compiler supplies it in a real build, which the e2e suite exercises end to end).
 */
const currentRequest = new Request("http://localhost:3000/_serverFn", { method: "POST" });

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => currentRequest,
}));

vi.mock("#/lib/auth.server", () => ({
  auth: { api: { getSession: vi.fn<() => Promise<unknown>>() } },
}));

/**
 * TanStack Start's async-local context is what a live server request provides and what the
 * middleware runner reads start options from. Supplying an empty one is what lets the real
 * server-side entry point run outside a request.
 */
vi.mock("@tanstack/start-storage-context", () => ({
  getStartContext: () => ({ startOptions: {}, contextAfterGlobalMiddlewares: {} }),
}));

interface ServerFunction {
  __executeServer: (opts: { method: "GET" | "POST"; data: unknown }) => Promise<unknown>;
}

async function call(serverFn: ServerFunction, data: unknown, method: "GET" | "POST" = "POST") {
  return (await serverFn["__executeServer"]({ method, data })) as {
    result?: unknown;
    error?: unknown;
  };
}

/** The refusal the function answered with, reduced to what a caller can observe. */
async function refusalFrom(
  serverFn: ServerFunction,
  data: unknown,
  method: "GET" | "POST" = "POST"
) {
  const { error } = await call(serverFn, data, method);
  if (!(error instanceof Response)) {
    throw new Error("expected a refusal Response, but the pipeline returned none");
  }

  return { status: error.status, body: await error.text() };
}

function signIn(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "usr_authz", email: "authz@example.com", role },
  } as never);
}

/**
 * PTR-98: runs `run` on the server side of the pipeline behind the real session guard, so its
 * throw reaches `withSession`'s error-class conversion as a handler's would. `.handler` is
 * required to attach `__executeServer`; the terminal body never runs in the uncompiled test
 * module (see the file comment), so the real handler is invoked from the middleware stage.
 */
function seam(run: () => Promise<unknown>) {
  return createServerFn({ method: "POST" })
    .middleware([requireSession])
    .middleware([
      createMiddleware({ type: "function" }).server(async ({ next }) => {
        await run();
        return next();
      }),
    ])
    .handler(() => undefined);
}

describe("server-function authorization (PTR-69)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PTR-16 coordination boundaries", () => {
    // These calls share the mocked request context; keep its lazy module loading sequential.
    // oxlint-disable no-await-in-loop
    const endpoints = [
      {
        fn: assignEventRequest,
        data: { id: 1, coordinatorId: "coord-b", expectedCoordinatorId: null },
        method: "POST" as const,
      },
      { fn: decideEventRequest, data: { id: 1, decision: "approved" }, method: "POST" as const },
      { fn: getCoordinationRequest, data: { id: 1 }, method: "GET" as const },
      { fn: takeUpEventRequestForReview, data: { id: 1 }, method: "POST" as const },
      { fn: listAssignedEventRequests, data: undefined, method: "GET" as const },
      { fn: listCoordinators, data: undefined, method: "GET" as const },
    ];
    it("requires a session for every coordination endpoint", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      for (const endpoint of endpoints) {
        expect(await refusalFrom(endpoint.fn, endpoint.data, endpoint.method)).toMatchObject({
          status: 401,
        });
      }
    });
    it.each(["attendee", "event_organiser", "venue_staff", "technical_support_staff"])(
      "refuses %s even before payload validation",
      async role => {
        signIn(role);
        for (const endpoint of endpoints) {
          expect(await refusalFrom(endpoint.fn, {}, endpoint.method)).toMatchObject({
            status: 403,
          });
        }
      }
    );
    it("permits a Coordinator through every boundary", async () => {
      signIn("event_coordinator");
      for (const endpoint of endpoints) {
        expect((await call(endpoint.fn, endpoint.data, endpoint.method)).error).toBeUndefined();
      }
    });
    // oxlint-enable no-await-in-loop
  });

  describe("venues", () => {
    it("answers 401 to an unauthenticated catalogue read", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(listVenues, undefined, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
      expect(await refusalFrom(searchVenues, {}, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("answers 403 to an external role the catalogue refuses", async () => {
      signIn("event_organiser");

      expect(await refusalFrom(listVenues, undefined, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
      expect(await refusalFrom(searchVenues, {}, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it.each(["event_coordinator", "venue_staff", "technical_support_staff"])(
      "lets an internal reader (%s) through to the rest of the chain",
      async role => {
        signIn(role);

        expect((await call(listVenues, undefined, "GET")).error).toBeUndefined();
      }
    );

    it("lets only a Coordinator search venues", async () => {
      signIn("event_coordinator");
      expect((await call(searchVenues, {}, "GET")).error).toBeUndefined();

      signIn("venue_staff");
      expect(await refusalFrom(searchVenues, {}, "GET")).toMatchObject({ status: 403 });

      signIn("technical_support_staff");
      expect(await refusalFrom(searchVenues, {}, "GET")).toMatchObject({ status: 403 });
    });

    it("answers 401 to an unauthenticated save (PTR-98)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(saveVenue, venueRecord)).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("answers 403 to an external role both ways of saving", async () => {
      signIn("event_organiser");

      expect(await refusalFrom(saveVenue, venueRecord)).toMatchObject({ status: 403 });
      expect(await refusalFrom(saveVenue, { ...venueRecord, id: 7 })).toMatchObject({
        status: 403,
      });
    });

    it("refuses a reader the write, so saveVenue is bound to the write permission", async () => {
      signIn("event_coordinator");

      expect(await refusalFrom(saveVenue, venueRecord)).toMatchObject({ status: 403 });
    });

    it("lets Venue Staff create and update", async () => {
      signIn("venue_staff");

      expect((await call(saveVenue, venueRecord)).error).toBeUndefined();
      expect((await call(saveVenue, { ...venueRecord, id: 7 })).error).toBeUndefined();
    });

    it("answers 401 to an unauthenticated single-venue read (PTR-98)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(getVenue, { id: 1 }, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
      expect(await refusalFrom(getVenueAvailability, availabilitySelection, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("refuses an external role the single-venue reads (PTR-98)", async () => {
      signIn("event_organiser");

      expect(await refusalFrom(getVenue, { id: 1 }, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
      expect(await refusalFrom(getVenueAvailability, availabilitySelection, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it.each(["event_coordinator", "venue_staff", "technical_support_staff"])(
      "lets an internal reader (%s) reach the rest of the single-venue chain (PTR-98)",
      async role => {
        signIn(role);

        expect((await call(getVenue, { id: 1 }, "GET")).error).toBeUndefined();
        expect(
          (await call(getVenueAvailability, availabilitySelection, "GET")).error
        ).toBeUndefined();
      }
    );
  });

  describe("events", () => {
    it("answers 401 to an unauthenticated list", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(listEvents, {}, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it.each([
      "attendee",
      "event_organiser",
      "event_coordinator",
      "venue_staff",
      "technical_support_staff",
    ])("lets a signed-in %s through the session guard", async role => {
      signIn(role);

      // The relationship scoping is data rather than a role permission, so no 403 is owed here;
      // `tests/integration/event-access.test.ts` runs the handler that decides per row.
      expect((await call(listEvents, {}, "GET")).error).toBeUndefined();
    });
  });

  describe("event requests", () => {
    it("answers 401 to an unauthenticated save", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(saveEventRequestDraft, {})).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("answers 403 to the attendee role", async () => {
      signIn("attendee");

      expect(await refusalFrom(saveEventRequestDraft, {})).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it("lets an event organiser through to the rest of the chain", async () => {
      signIn("event_organiser");

      expect((await call(saveEventRequestDraft, {})).error).toBeUndefined();
    });

    it("answers 401 to an unauthenticated submission", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(submitEventRequest, { id: 1 })).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("answers 403 to the attendee role on submission", async () => {
      signIn("attendee");

      expect(await refusalFrom(submitEventRequest, { id: 1 })).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it("answers 401 to an unauthenticated list or read (PTR-14)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(listEventRequests, undefined, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
      expect(await refusalFrom(getEventRequest, { id: 1 }, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("answers 403 to an internal role reading the organiser's list (PTR-14)", async () => {
      signIn("event_coordinator");

      expect(await refusalFrom(listEventRequests, undefined, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
      expect(await refusalFrom(getEventRequest, { id: 1 }, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it("lets an event organiser list and read (PTR-14)", async () => {
      signIn("event_organiser");

      expect((await call(listEventRequests, undefined, "GET")).error).toBeUndefined();
      expect((await call(getEventRequest, { id: 1 }, "GET")).error).toBeUndefined();
    });

    it("answers 401 and 403 on the unassigned list, and lets a Coordinator through (PTR-15)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);
      expect(await refusalFrom(listUnassignedEventRequests, undefined, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });

      signIn("event_organiser");
      expect(await refusalFrom(listUnassignedEventRequests, undefined, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });

      signIn("event_coordinator");
      expect((await call(listUnassignedEventRequests, undefined, "GET")).error).toBeUndefined();
    });

    it("answers 401 to an unauthenticated draft read or delete (PTR-98)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(getEventRequestDraft, { id: 1 }, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
      expect(await refusalFrom(deleteEventRequestDraft, { id: 1 })).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("refuses an attendee the draft read and delete (PTR-98)", async () => {
      signIn("attendee");

      expect(await refusalFrom(getEventRequestDraft, { id: 1 }, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
      expect(await refusalFrom(deleteEventRequestDraft, { id: 1 })).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it("lets an event organiser through the draft read and delete chain (PTR-98)", async () => {
      signIn("event_organiser");

      expect((await call(getEventRequestDraft, { id: 1 }, "GET")).error).toBeUndefined();
      expect((await call(deleteEventRequestDraft, { id: 1 })).error).toBeUndefined();
    });
  });

  describe("accounts", () => {
    it("answers 401 to an unauthenticated settings load", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect(await refusalFrom(listAccounts, undefined, "GET")).toEqual({
        status: 401,
        body: "Unauthorized",
      });
    });

    it("lets any signed-in role through", async () => {
      signIn("attendee");

      expect((await call(listAccounts, undefined, "GET")).error).toBeUndefined();
    });

    // `getCurrentUser` is intentionally session-optional (the root route reads it to tell a
    // signed-out visitor they are signed out), so "no session" is the allow path, not a 401.
    it("answers the current user with no session, so a rewire to requireSession would fail (PTR-98)", async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null);

      expect((await call(getCurrentUser, undefined, "GET")).error).toBeUndefined();
    });

    it.each([
      "attendee",
      "event_organiser",
      "event_coordinator",
      "venue_staff",
      "technical_support_staff",
    ])("lets a signed-in %s read the current user (PTR-98)", async role => {
      signIn(role);

      expect((await call(getCurrentUser, undefined, "GET")).error).toBeUndefined();
    });
  });

  /**
   * PTR-98: the matrix above proves each endpoint refuses at the middleware boundary, and the
   * handler tests prove each handler throws the right error class. Neither executes the join —
   * `withSession`'s catch that turns that class into the `Response` a direct caller receives.
   *
   * The uncompiled test module carries no handler body (the compiler supplies it in a real
   * build; see the file comment), so each case calls a real handler from a middleware placed
   * after the real session guard. The handler's throw then travels the same `next()` path a
   * terminal handler's would, into `withSession`'s conversion.
   */
  describe("refusal seam (PTR-98)", () => {
    let pool: Pool;
    let database: ReturnType<typeof drizzle<typeof schema>>;

    beforeAll(() => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      database = drizzle(pool, { schema });
    });

    afterAll(async () => {
      await pool.end();
    });

    const organiser: SessionUser = {
      id: "test-user-2",
      email: "jane.doe@example.com",
      role: "event_organiser",
    };

    function signInOrganiser() {
      vi.mocked(auth.api.getSession).mockResolvedValue({ user: organiser } as never);
    }

    it("turns a handler's AuthorizationError into the 403 a direct caller receives", async () => {
      signInOrganiser();

      const refused = await refusalFrom(
        seam(() =>
          handleDeleteEventRequestDraft({ id: 2_147_483_647 }, organiser, database as never)
        ),
        {}
      );

      expect(refused).toEqual({ status: 403, body: "Forbidden" });
    });

    it("turns a handler's NotFoundError into the 404 a direct caller receives", async () => {
      signInOrganiser();

      const refused = await refusalFrom(
        seam(() => handleSaveVenue({ ...venueRecord, id: 2_147_483_647 }, database as never)),
        {}
      );

      expect(refused).toEqual({ status: 404, body: "Not Found" });
    });

    it("turns a handler's ConflictError into the 409 a direct caller receives", async () => {
      signInOrganiser();

      const [submitted] = await database
        .insert(schema.eventRequests)
        .values({
          organiserId: organiser.id,
          status: "submitted",
          submittedAt: new Date(),
          eventName: "PTR-98 refusal seam fixture",
        })
        .returning();

      try {
        const refused = await refusalFrom(
          seam(() =>
            handleDeleteEventRequestDraft({ id: submitted.id }, organiser, database as never)
          ),
          {}
        );

        expect(refused).toEqual({ status: 409, body: EVENT_REQUEST_DELETE_REFUSAL });
      } finally {
        await database
          .delete(schema.eventRequests)
          .where(eq(schema.eventRequests.id, submitted.id));
      }
    });

    it("refuses a non-owning organiser on delete through the handler, and writes nothing (PTR-98)", async () => {
      signInOrganiser();

      // Owned by someone else: the guard admits the organiser, so the handler's scoping is what refuses.
      const [draft] = await database
        .insert(schema.eventRequests)
        .values({ organiserId: "test-user-1", eventName: "PTR-98 non-owner fixture" })
        .returning();

      try {
        const refused = await refusalFrom(
          seam(() => handleDeleteEventRequestDraft({ id: draft.id }, organiser, database as never)),
          {}
        );

        expect(refused).toEqual({ status: 403, body: "Forbidden" });
        expect(
          await database
            .select({ id: schema.eventRequests.id })
            .from(schema.eventRequests)
            .where(eq(schema.eventRequests.id, draft.id))
        ).toHaveLength(1);
      } finally {
        await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, draft.id));
      }
    });

    it("refuses an attendee before the guarded work runs, and lets an organiser run it (PTR-98)", async () => {
      const guardedWork = vi.fn<() => void>();
      const probe = createServerFn({ method: "POST" })
        .middleware([requireEventRequestCreate])
        .middleware([
          createMiddleware({ type: "function" }).server(async ({ next }) => {
            guardedWork();
            return next();
          }),
        ])
        .handler(() => undefined);

      signIn("attendee");
      expect(await refusalFrom(probe, {})).toEqual({ status: 403, body: "Forbidden" });
      expect(guardedWork).not.toHaveBeenCalled();

      signIn("event_organiser");
      expect((await call(probe, {})).error).toBeUndefined();
      expect(guardedWork).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * PTR-98: with the session guard satisfied, the validator the server function declares runs on
   * the server side of the same pipeline — `execValidator` is reached from the base middleware the
   * compiler would otherwise fill in. The handler body stays out of a Vitest build (see the file
   * comment), but the schema is part of the boundary and its refusal is observable here. Each case
   * signs in a role the guard admits so the failure comes from validation, not permission.
   */
  describe("validation at the server-function boundary (PTR-98)", () => {
    async function messageFrom(
      serverFn: ServerFunction,
      data: unknown,
      method: "GET" | "POST" = "POST"
    ) {
      const { error } = await call(serverFn, data, method);
      if (!(error instanceof Error)) {
        throw new Error(
          "expected the validator to refuse with an Error, but the pipeline returned none"
        );
      }
      return error.message;
    }

    it("surfaces each function's own schema message instead of reaching the handler", async () => {
      signIn("venue_staff");
      expect(await messageFrom(saveVenue, { name: "" })).toBe(NAME_REQUIRED_MESSAGE);

      signIn("event_coordinator");
      expect(await messageFrom(getVenue, { id: "seven" }, "GET")).toBe(VENUE_ID_MESSAGE);
      expect(
        await messageFrom(
          getVenueAvailability,
          { venueId: 1, startDate: "2026-05-10", endDate: "2026-05-01" },
          "GET"
        )
      ).toBe(AVAILABILITY_ORDER_MESSAGE);
      expect(
        await messageFrom(assignEventRequest, {
          id: 1,
          coordinatorId: "   ",
          expectedCoordinatorId: null,
        })
      ).toBe("Choose an Event Coordinator");
      expect(await messageFrom(getCoordinationRequest, { id: 0 }, "GET")).toBe(
        EVENT_REQUEST_ID_MESSAGE
      );

      signIn("event_organiser");
      expect(await messageFrom(saveEventRequestDraft, { expectedAttendance: -1 })).toBe(
        ATTENDANCE_MESSAGE
      );
      expect(await messageFrom(getEventRequest, { id: "1" }, "GET")).toBe(EVENT_REQUEST_ID_MESSAGE);
    });

    it("validates the session-guarded list before it can answer", async () => {
      signIn("attendee");

      expect(await messageFrom(listEvents, { eventId: "41" }, "GET")).toBe("Choose an event");
    });
  });
});
