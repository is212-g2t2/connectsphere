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
 * venue row that is not there, a submitted request that is no longer an editable draft), and the
 * `Response` they become is served verbatim by TanStack Start, so a direct HTTP caller gets the
 * real 401/403/404/409 and an in-app caller receives that `Response` as a resolved value — the
 * protocol the routes already unwrap. Anything else is a genuine fault and keeps travelling as
 * an error.
 */
export const withSession = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    const [{ getRequest }, { auth }] = await loadAuthServer();
    const session = await auth.api.getSession({ headers: getRequest().headers });
    return await next({ context: { user: getSessionUser(session) } });
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof NotFoundError ||
      error instanceof ConflictError
    ) {
      throw new Response(error.message, { status: error.status });
    }
    throw error;
  }
});

/** `withSession` plus the 401 when nobody is signed in. */
export const requireSession = createMiddleware({ type: "function" })
  .middleware([withSession])
  .server(({ next, context }) => {
    if (!context.user) {
      throw new Response("Unauthorized", { status: 401 });
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
        throw new Response("Forbidden", { status: 403 });
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
 * The client half of the refusal protocol `withSession` describes: a refused server function
 * resolves with its `Response` in the browser, but rejects with it during SSR. Both become an
 * `Error` whose message the route can serialize and display; `fallbackMessage` covers an empty body.
 */
export async function unwrapRefusal<T>(
  result: T | Response | PromiseLike<T | Response>,
  fallbackMessage: string
): Promise<T> {
  const value = await Promise.resolve(result).catch((error: unknown) => {
    if (error instanceof Response) return error;
    throw error;
  });
  if (value instanceof Response) throw new Error((await value.text()) || fallbackMessage);
  return value;
}

/**
 * The refusal a handler still throws on its own — the row exists but belongs to someone else
 * (event-request drafts are scoped to their organiser). A plain `Error` on purpose, not a
 * `Response`: it is thrown from a pure `handle*` function that integration tests call directly,
 * and the message is the existing contract. `withSession` converts it to a 403 `Response`.
 */
export class AuthorizationError extends Error {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
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
