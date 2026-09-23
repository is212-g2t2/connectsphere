import { createMiddleware, createServerFn } from "@tanstack/react-start";

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

function loadAuthServer() {
  return Promise.all([import("@tanstack/react-start/server"), import("#/lib/auth.server")]);
}

/**
 * Resolves the Better Auth session once per request and puts the sanitised user — or `null` —
 * on the server function's context. It is also the pipeline's refusal boundary: a handler may
 * still throw the status-carrying errors below (a draft that belongs to another organiser, a
 * venue row that is not there, a submitted request that is no longer an editable draft), and
 * sets the HTTP response status via `setResponseStatus`. Anything else is a genuine fault and
 * keeps travelling as an error.
 */
export const withSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const [{ getRequest, setResponseStatus }, { auth }] = await loadAuthServer();
  try {
    const session = await auth.api.getSession({ headers: getRequest().headers });
    return await next({ context: { user: getSessionUser(session) } });
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      setResponseStatus(error.status);
      throw error;
    }
    throw error;
  }
});

/** `withSession` plus the 401 when nobody is signed in. */
export const requireSession = createMiddleware({ type: "function" })
  .middleware([withSession])
  .server(({ next, context }) => {
    if (!context.user) {
      throw new AuthorizationError("Unauthorized", 401);
    }

    // Re-emitted non-null: `next()` merges context, so everything downstream sees a
    // `SessionUser` and never repeats the check.
    return next({ context: { user: context.user } });
  });

/**
 * `requireSession` plus the role/function check (PTR-7), answering 403.
 *
 * The required permission may be derived from the payload when it depends on the data —
 * `saveVenue` is a `create` or an `update` depending on whether an id is present. The payload is
 * raw here (the server function's own `.validator()` runs after the middleware pipeline), so an
 * accessor may only pick between permissions the caller would need for the operation the handler
 * is about to perform; it must never let unvalidated input lower a requirement.
 */
export function requirePermission(
  required: PermissionRequest | ((data: unknown) => PermissionRequest)
) {
  return createMiddleware({ type: "function" })
    .middleware([requireSession])
    .server(({ next, context, data }) => {
      const request = typeof required === "function" ? required(data) : required;
      if (!can(context.user.role, request)) {
        throw new AuthorizationError("Forbidden");
      }

      return next({ context: { user: context.user } });
    });
}

export const getCurrentUser = createServerFn({ method: "GET" })
  .middleware([withSession])
  .handler(({ context }) => context.user);

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async () => {
    const [{ getRequest }, { auth }] = await loadAuthServer();

    return auth.api.listUserAccounts({
      headers: getRequest().headers,
    });
  });

/**
 * The refusal a handler still throws on its own — the row exists but belongs to someone else
 * (event-request drafts are scoped to their organiser). A plain `Error` on purpose, not a
 * `Response`: it is thrown from a pure `handle*` function that integration tests call directly,
 * and the message is the existing contract. `withSession` sets the HTTP status code via `setResponseStatus`.
 */
export class AuthorizationError extends Error {
  readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

/**
 * The other status a server function has to be able to answer with. Deliberately not a wider
 * `AuthorizationError`: a row that does not exist was never refused, and telling a Venue Staff
 * member their role forbids an id they mistyped blames them for someone else's deletion. It sits
 * next to `AuthorizationError` because the status-carrying errors live beside each other in this
 * file — `withSession` is the one module that converts them.
 */
export class NotFoundError extends Error {
  readonly status = 404;

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The row exists and belongs to the caller, but its state refuses the operation: a submitted
 * event request is no longer an editable draft (PTR-13 criterion 3). 409 rather than 403 — the
 * role is not the problem — and the message is what directs the organiser to the clarification
 * or change-request route they do have.
 */
export class ConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
