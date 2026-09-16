import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select";
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

  return (
    <EventRequestDetailPage
      request={request}
      back={{ to: "/coordination", label: "Back to coordination" }}
    >
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
                <NativeSelect
                  id={field.name}
                  required
                  className="w-full"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={event => field.handleChange(event.target.value)}
                  disabled={assigning}
                  aria-invalid={field.state.meta.errors.length > 0}
                >
                  <NativeSelectOption value="">Choose an Event Coordinator</NativeSelectOption>
                  {coordinators
                    .filter(coordinator => coordinator.id !== request.assignedCoordinatorId)
                    .map(coordinator => (
                      <NativeSelectOption key={coordinator.id} value={coordinator.id}>
                        {coordinator.name} ({coordinator.email})
                        {coordinator.id === user.id ? " — you" : ""}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
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
          <p role="alert" className="mt-4 text-sm text-destructive">
            {assignment.error}
          </p>
        )}
      </section>
    </EventRequestDetailPage>
  );
}
