import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
} from "#/features/events/registration";
import { registerForEvent } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/** The server's named refusals. Any other failure falls back to the generic text. */
function isRegistrationRefusal(message: string): boolean {
  return (
    message === REGISTRATION_NOT_OPEN_MESSAGE ||
    message === ALREADY_REGISTERED_MESSAGE ||
    message.startsWith(EVENT_FULL_MESSAGE)
  );
}

/**
 * PTR-45: the Attendee registers for the event. The action stays available and the server says
 * why it refuses, because whether the period is open or a place is left can change after the page
 * loads. PTR-50 owns stating that before the Attendee tries.
 */
export function RegisterAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  const router = useRouter();
  const [state, register, registering] = useMutation(async () => {
    try {
      await registerForEvent({ data: { id: eventId } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // The registration the refusal names may have changed since this page loaded.
      await router.invalidate();
      throw isRegistrationRefusal(message) ? error : new Error();
    }
    toast.success(`You are registered for ${eventName}.`);
    await router.invalidate();
  }, "Could not register for this event. Try again.");

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <Button size="sm" disabled={registering} onClick={() => void register()}>
        {registering ? "Registering…" : "Register"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="body-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
