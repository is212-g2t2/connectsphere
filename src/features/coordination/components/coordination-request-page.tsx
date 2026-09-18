import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { unwrapRefusal } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { CoordinatorSelection } from "#/features/coordination/schema";
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
  const navigate = useNavigate();
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
    toast.success("Assignment recorded.");
    // Leave the old detail immediately: the actor may have just relinquished access to it.
    await navigate({ to: "/coordination" });
  }, "Could not assign this request. Try again.");

  const form = useForm({
    defaultValues: { coordinatorId: "" },
    validators: { onSubmit: CoordinatorSelection },
    onSubmit: async ({ value }) => {
      await assign(value.coordinatorId);
    },
  });

  const availableCoordinators = coordinators.filter(
    coordinator => coordinator.id !== request.assignedCoordinatorId
  );

  return (
    <EventRequestDetailPage
      request={request}
      back={{ to: "/coordination", label: "Back to coordination" }}
    >
      <section className="mt-8" aria-labelledby="assignment-heading">
        <Card>
          <CardContent>
            <h2 id="assignment-heading" className="display-h3">
              {unassigned ? "Assign this request" : "Reassign this request"}
            </h2>
            <p className="mt-2 body-sm text-muted-foreground">
              Organiser: {request.organiser.name} —{" "}
              <a href={`mailto:${request.organiser.email}`} className={NAV_LINK_CLASSNAME}>
                {request.organiser.email}
              </a>
            </p>
            {!unassigned && (
              <p className="mt-2 body-sm text-muted-foreground">
                Assigned on {formatInstant(request.assignedAt)}. Handing this request over removes
                your coordination access.
              </p>
            )}
            <form
              noValidate
              className="mt-5 space-y-3"
              onSubmit={event => {
                event.preventDefault();
                if (assigning) return;
                void form.handleSubmit();
              }}
            >
              <form.Field name="coordinatorId">
                {field => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={field.name}>Event Coordinator</FieldLabel>
                    <Select
                      value={field.state.value === "" ? null : field.state.value}
                      onValueChange={value => field.handleChange(value ?? "")}
                      disabled={assigning}
                      required
                    >
                      <SelectTrigger
                        id={field.name}
                        className="w-full"
                        aria-invalid={field.state.meta.errors.length > 0}
                        onBlur={field.handleBlur}
                      >
                        <SelectValue>
                          {(value: string | null) => {
                            const selected = availableCoordinators.find(
                              coordinator => coordinator.id === value
                            );
                            return selected
                              ? coordinatorLabel(selected, user.id)
                              : "Choose an Event Coordinator";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {availableCoordinators.map(coordinator => (
                          <SelectItem key={coordinator.id} value={coordinator.id}>
                            {coordinatorLabel(coordinator, user.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <div className="flex flex-wrap gap-3">
                <form.Subscribe selector={state => state.values.coordinatorId}>
                  {coordinatorId => (
                    <Button type="submit" disabled={assigning || !coordinatorId}>
                      {assigning
                        ? "Assigning…"
                        : unassigned
                          ? "Assign Coordinator"
                          : "Reassign Coordinator"}
                    </Button>
                  )}
                </form.Subscribe>
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
              <p role="alert" className="mt-4 body-sm text-destructive">
                {assignment.error}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </EventRequestDetailPage>
  );
}

function coordinatorLabel(coordinator: Coordinator, currentUserId: string) {
  return `${coordinator.name} (${coordinator.email})${coordinator.id === currentUserId ? " — you" : ""}`;
}
