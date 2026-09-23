/**
 * Whether a Drizzle-wrapped driver error is a Postgres constraint violation for `constraint`.
 * Postgres reports the violated constraint's name on `cause`, and the two write paths that turn
 * one into a readable message — the venue name's unique index and the pending venue request's
 * partial index — must agree on that shape or their mapping silently stops working.
 */
export function isConstraintViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "constraint" in error.cause &&
    error.cause.constraint === constraint
  );
}
