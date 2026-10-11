/**
 * Check whether a Drizzle-wrapped driver error reports the given Postgres constraint violation.
 * Postgres puts the constraint name in `cause`. The write paths use this shape to map the venue
 * name's unique index, the pending venue request's partial index, and the booking overlap
 * exclusion to readable messages.
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
