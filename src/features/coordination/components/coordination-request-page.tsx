import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { unwrapRefusal } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { assignEventRequest } from "#/features/coordination/server-fns";
import type { Coordinator, CoordinationRequest } from "#/features/coordination/server-fns";
import { EventRequestDetailPage } from "#/features/event-requests/components/request-detail-page";
import { formatInstant } from "#/features/event-requests/format";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export function CoordinationRequestPage({
  request,
  coordinators,
  user,
}: {
  request: CoordinationRequest;
  coordinators: Coordinator[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [coordinatorId, setCoordinatorId] = useState("");
  const unassigned = request.assignedCoordinatorId === null;
  const [assignment, assign, assigning] = useMutation(async (incomingId: string) => {
    await unwrapRefusal(
      assignEventRequest({
        data: {
          id: request.id,
          coordinatorId: incomingId,
          expectedCoordinatorId: request.assignedCoordinatorId,
        },
      }),
      "Could not assign this request. Try again."
    );
    toast.success(
      "Assignment recorded. The Organiser and incoming Coordinator have been notified."
    );
    // Leave the old detail immediately: the actor may have just relinquished access to it.
    await router.navigate({ to: "/coordination" });
    await router.invalidate();
  }, "Could not assign this request. Try again.");

  return (
    <EventRequestDetailPage request={request} backTo="/coordination">
      <section
        className="mt-8 rounded-lg border border-border p-6"
        aria-labelledby="assignment-heading"
      >
        <h2 id="assignment-heading" className="text-lg font-semibold">
          {unassigned ? "Assign this request" : "Reassign this request"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Organiser: {request.organiser.name} —{" "}
          <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
            {request.organiser.email}
          </a>
        </p>
        {!unassigned && (
          <p className="mt-2 text-sm text-muted-foreground">
            Assigned on {formatInstant(request.assignedAt)}. Handing this request over removes your
            coordination access.
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          The Organiser and incoming Coordinator receive an assignment notification on their
          dashboards.
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={event => {
            event.preventDefault();
            void assign(coordinatorId);
          }}
        >
          <label htmlFor="coordinator" className="block text-sm font-medium">
            Event Coordinator
          </label>
          <select
            id="coordinator"
            required
            value={coordinatorId}
            onChange={event => setCoordinatorId(event.target.value)}
            disabled={assigning}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose an Event Coordinator</option>
            {coordinators
              .filter(coordinator => coordinator.id !== request.assignedCoordinatorId)
              .map(coordinator => (
                <option key={coordinator.id} value={coordinator.id}>
                  {coordinator.name} ({coordinator.email})
                  {coordinator.id === user.id ? " — you" : ""}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={assigning || !coordinatorId}>
              {assigning
                ? "Assigning…"
                : unassigned
                  ? "Assign Coordinator"
                  : "Reassign Coordinator"}
            </Button>
            {unassigned && (
              <Button
                type="button"
                variant="outline"
                disabled={assigning}
                onClick={() => {
                  void assign(user.id);
                }}
              >
                Assign to me
              </Button>
            )}
          </div>
        </form>
        {assignment.status === "error" && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {assignment.error}
          </p>
        )}
      </section>
    </EventRequestDetailPage>
  );
}
