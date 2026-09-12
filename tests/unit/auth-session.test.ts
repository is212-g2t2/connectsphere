import { describe, expect, it } from "vitest";
import {
  assertNotRefused,
  getSessionUser,
  NOT_PERMITTED_MESSAGE,
  SIGNED_OUT_MESSAGE,
} from "#/features/auth/session";

describe("getSessionUser helper", () => {
  it("returns null when session is null or has no user", () => {
    expect(getSessionUser(null)).toBeNull();
    expect(getSessionUser({})).toBeNull();
  });

  it("returns sanitized SessionUser when valid session exists", () => {
    const rawSession = {
      user: {
        id: "usr_42",
        email: "alice@example.com",
        name: "Alice",
        image: "https://example.com/avatar.jpg",
        role: "attendee",
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: true,
      },
      session: {
        id: "sess_42",
        userId: "usr_42",
        expiresAt: new Date(),
        token: "valid_token",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    const user = getSessionUser(rawSession);
    expect(user).toEqual({
      id: "usr_42",
      email: "alice@example.com",
      name: "Alice",
      image: "https://example.com/avatar.jpg",
      role: "attendee",
    });
  });

  it("handles user without role by returning role as undefined", () => {
    const rawSession = {
      user: {
        id: "usr_43",
        email: "bob@example.com",
      },
    };

    const user = getSessionUser(rawSession);
    expect(user).toEqual({
      id: "usr_43",
      email: "bob@example.com",
      name: undefined,
      image: undefined,
      role: undefined,
    });
  });
});

/**
 * A server function that throws a `Response` resolves to that Response on the client
 * (`x-tss-raw`), so the in-app caller has to turn it back into a rejection itself.
 */
describe("assertNotRefused", () => {
  it("passes an ordinary result through untouched", () => {
    const venue = { id: 1, name: "Harbour Hall" };
    expect(assertNotRefused(venue)).toBe(venue);
    expect(assertNotRefused(null)).toBeNull();
  });

  it("turns a 401 Response into the signed-out message", () => {
    expect(() => assertNotRefused(new Response("Unauthorized", { status: 401 }))).toThrow(
      SIGNED_OUT_MESSAGE
    );
  });

  it("turns a 403 Response into the not-permitted message", () => {
    expect(() => assertNotRefused(new Response("Forbidden", { status: 403 }))).toThrow(
      NOT_PERMITTED_MESSAGE
    );
  });
});
