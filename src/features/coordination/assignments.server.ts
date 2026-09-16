import { and, asc, desc, eq, getTableColumns, ne, or, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { db as Db } from "#/db";
import { eventAssignments, eventRequests, user } from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { parseAssignmentInput } from "#/features/coordination/schema";
import { parseEventRequestId } from "#/features/event-requests/schema";

/**
 * Server-only on purpose, and named for it. `#/db/schema` is a value import here: the table
 * builders run at module scope, so a bundler cannot treat the module as side-effect free and
 * drops nothing — importing this from anywhere the browser can reach would ship the whole
 * database schema, Better Auth tables included. `server-fns.ts` reaches it through a dynamic
 * `import()` inside `.handler()`, which is the seam that keeps it off the client.
 *
 * The middleware pipeline has already verified the session and `event_request:coordinate`
 * before these handlers run.
 */

type Database = typeof Db;
const organisers = alias(user, "organiser");
const coordinators = alias(user, "coordinator");

export async function handleListAssignedEventRequests(actor: SessionUser, database: Database) {
  return database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: user.name, email: user.email },
    })
    .from(eventRequests)
    .innerJoin(user, eq(user.id, eventRequests.organiserId))
    .where(
      and(ne(eventRequests.status, "draft"), eq(eventRequests.assignedCoordinatorId, actor.id))
    )
    .orderBy(desc(eventRequests.assignedAt), desc(eventRequests.id));
}

export async function handleListCoordinators(database: Database) {
  return database
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.role, "event_coordinator"))
    .orderBy(asc(user.name), asc(user.id));
}

/** Re-reads ownership on every request; a previous assignment never confers access. */
export async function handleGetCoordinationRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const { id } = parseEventRequestId(data);
  const rows = await database
    .select({
      ...getTableColumns(eventRequests),
      organiser: { name: organisers.name, email: organisers.email },
      coordinator: { name: coordinators.name, email: coordinators.email },
    })
    .from(eventRequests)
    .innerJoin(organisers, eq(organisers.id, eventRequests.organiserId))
    .leftJoin(coordinators, eq(coordinators.id, eventRequests.assignedCoordinatorId))
    .where(
      and(
        eq(eventRequests.id, id),
        ne(eventRequests.status, "draft"),
        or(
          isNull(eventRequests.assignedCoordinatorId),
          eq(eventRequests.assignedCoordinatorId, actor.id)
        )
      )
    );
  const request = rows.at(0);
  if (!request)
    throw new AuthorizationError(
      "You no longer have coordination access to this request, or it is unavailable."
    );
  return request;
}

/** The row lock serialises pickups and handovers; all effects either commit together or roll back. */
export async function handleAssignEventRequest(
  data: unknown,
  actor: SessionUser,
  database: Database
) {
  const input = parseAssignmentInput(data);
  return database.transaction(async tx => {
    const rows = await tx
      .select()
      .from(eventRequests)
      .where(eq(eventRequests.id, input.id))
      .for("update");
    const request = rows.at(0);
    if (
      !request ||
      request.status === "draft" ||
      (request.assignedCoordinatorId !== null && request.assignedCoordinatorId !== actor.id)
    ) {
      throw new AuthorizationError(
        "Only the assigned Coordinator can reassign this request. Unassigned requests can be picked up by any Event Coordinator."
      );
    }
    if (request.assignedCoordinatorId !== input.expectedCoordinatorId) {
      throw new ConflictError("This assignment has changed. Refresh the request and try again.");
    }
    if (request.assignedCoordinatorId === input.coordinatorId) {
      throw new ConflictError("This Coordinator is already assigned to the request.");
    }

    // Hold the selected account while its role is validated and the assignment is committed.
    const incoming = (
      await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, input.coordinatorId), eq(user.role, "event_coordinator")))
        .for("share")
    ).at(0);
    if (!incoming) throw new ConflictError("Choose an existing Event Coordinator.");

    const now = new Date();
    const [updated] = await tx
      .update(eventRequests)
      .set({ assignedCoordinatorId: incoming.id, assignedAt: now })
      .where(eq(eventRequests.id, request.id))
      .returning();
    await tx.insert(eventAssignments).values({
      eventRequestId: request.id,
      fromCoordinatorId: request.assignedCoordinatorId,
      toCoordinatorId: incoming.id,
      actorId: actor.id,
      createdAt: now,
    });
    return updated;
  });
}
