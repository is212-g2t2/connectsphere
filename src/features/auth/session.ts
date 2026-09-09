import { createServerFn } from "@tanstack/react-start";

import { can } from "#/features/auth/permissions";
import type { PermissionRequest } from "#/features/auth/permissions";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
}

export function getSessionUser(
  session: {
    user?: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role?: string | null;
    };
  } | null
): SessionUser | null {
  if (!session?.user) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image,
    role: session.user.role,
  };
}

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const [{ getRequest }, { auth }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("#/lib/auth"),
  ]);

  const session = await auth.api.getSession({
    headers: getRequest().headers,
  });

  return getSessionUser(session);
});

/**
 * Carries the HTTP status the refusal deserves, so a caller can answer 401/403 instead of a
 * generic failure (PTR-7 criterion 2). A plain `Error` on purpose, not a `Response`: these are
 * thrown from pure `handle*` functions that unit tests call directly, and the messages are the
 * existing contract.
 */
export class AuthorizationError extends Error {
  constructor(
    message: "Unauthorized" | "Forbidden",
    readonly status: 401 | 403
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * The authorisation gate every server-side entry point calls (PTR-7). It lives here rather than
 * in `permissions.ts` so the matrix stays free of any session dependency and safe for the
 * browser to import.
 */
export function requirePermission(
  user: SessionUser | null,
  request: PermissionRequest
): SessionUser {
  if (!user) throw new AuthorizationError("Unauthorized", 401);
  if (!can(user.role, request)) throw new AuthorizationError("Forbidden", 403);
  return user;
}
