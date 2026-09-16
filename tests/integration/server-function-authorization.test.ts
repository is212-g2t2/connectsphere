import { beforeEach, describe, expect, it, vi } from "vitest";

import { listAccounts } from "#/features/auth/session";
import {
  assignEventRequest,
  getCoordinationRequest,
  listAssignedEventRequests,
  listCoordinators,
} from "#/features/coordination/server-fns";
import {
  getEventRequest,
  listEventRequests,
  listUnassignedEventRequests,
  saveEventRequestDraft,
  submitEventRequest,
} from "#/features/event-requests/server-fns";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { listVenues, saveVenue } from "#/features/venues/server-fns";
import { auth } from "#/lib/auth.server";

/** A payload the venue validator accepts, so the allow path runs the whole chain. */
const venueRecord = {
  name: "New room",
  location: "Level 3",
  maxCapacity: 10,
  operatingHours: DEFAULT_OPERATING_HOURS,
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
      { fn: getCoordinationRequest, data: { id: 1 }, method: "GET" as const },
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
    it("permits a Coordinator through all four boundaries", async () => {
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
    });

    it("answers 403 to an external role the catalogue refuses", async () => {
      signIn("event_organiser");

      expect(await refusalFrom(listVenues, undefined, "GET")).toEqual({
        status: 403,
        body: "Forbidden",
      });
    });

    it("lets an internal reader through to the rest of the chain", async () => {
      signIn("event_coordinator");

      expect((await call(listVenues, undefined, "GET")).error).toBeUndefined();
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
  });
});
