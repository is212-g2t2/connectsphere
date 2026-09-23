import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  ConflictError,
  getSessionUser,
  NotFoundError,
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

describe("status-carrying error classes", () => {
  it("creates AuthorizationError with status 403 by default", () => {
    const error = new AuthorizationError("Forbidden");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthorizationError");
    expect(error.message).toBe("Forbidden");
    expect(error.status).toBe(403);
  });

  it("creates AuthorizationError with explicit status 401", () => {
    const error = new AuthorizationError("Unauthorized", 401);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthorizationError");
    expect(error.message).toBe("Unauthorized");
    expect(error.status).toBe(401);
  });

  it("creates AuthorizationError with explicit status", () => {
    const error = new AuthorizationError("Custom refusal", 401);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Custom refusal");
  });

  it("creates NotFoundError with status 404", () => {
    const error = new NotFoundError("Not Found");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("Not Found");
    expect(error.status).toBe(404);
  });

  it("creates ConflictError with status 409", () => {
    const error = new ConflictError("Conflict");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConflictError");
    expect(error.message).toBe("Conflict");
    expect(error.status).toBe(409);
  });
});
