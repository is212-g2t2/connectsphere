import { describe, expect, it } from "vitest";
import { getSessionUser, unwrapRefusal } from "#/features/auth/session";

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

describe("unwrapRefusal helper", () => {
  it("returns a non-refusal result untouched", async () => {
    const row = { id: 7 };

    await expect(unwrapRefusal(row, "fallback")).resolves.toBe(row);
  });

  it("throws an Error carrying the refusal body", async () => {
    const refusal = new Response("Forbidden", { status: 403 });

    await expect(unwrapRefusal(refusal, "fallback")).rejects.toThrow("Forbidden");
  });

  it("does not attach a status to the thrown error", async () => {
    // Deliberate: nothing branches on the refusal status yet; attach it when a story needs to.
    const refusal = new Response("Forbidden", { status: 403 });

    await expect(unwrapRefusal(refusal, "fallback")).rejects.not.toHaveProperty("status");
  });

  it("falls back when the refusal body is empty", async () => {
    const refusal = new Response("", { status: 401 });

    await expect(unwrapRefusal(refusal, "Could not save this draft. Try again.")).rejects.toThrow(
      "Could not save this draft. Try again."
    );
  });
});
