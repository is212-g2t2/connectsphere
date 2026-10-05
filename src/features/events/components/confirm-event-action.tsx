import { CONFIRMATION_REFUSAL_HEADING } from "#/features/events/confirmation";
import { confirmEvent } from "#/features/events/server-fns";
import { EventTransitionAction } from "#/features/events/components/event-transition-action";

/**
 * PTR-24 AC1/AC2: the assigned Coordinator confirms the event. The action stays available while
 * arrangements are outstanding on purpose: the refusal names every outstanding item, which is
 * more use than a disabled button that cannot say why. Only the server's named refusal is shown
 * verbatim; any other failure falls back to the generic text.
 */
export function ConfirmEventAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  return (
    <EventTransitionAction
      eventName={eventName}
      run={() => confirmEvent({ data: { id: eventId } })}
      triggerLabel="Confirm event"
      pendingLabel="Confirming…"
      dialogTitle="Confirm event"
      dialogDescription={`This confirms ${eventName} once its venue and technical arrangements are in place, and notifies the Organiser.`}
      actionLabel="Confirm"
      successMessage="Event confirmed. The Organiser will be notified."
      failureMessage="Could not confirm this event. Try again."
      refusalHeading={CONFIRMATION_REFUSAL_HEADING}
      invalidateOnRefusal
    />
  );
}
