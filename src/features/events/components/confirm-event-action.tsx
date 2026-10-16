import { CONFIRMATION_REFUSAL_HEADING } from "#/features/events/confirmation";
import { confirmEvent } from "#/features/events/server-fns";
import { EventTransitionAction } from "#/features/events/components/event-transition-action";

/**
 * PTR-24 AC1/AC2: The assigned Coordinator confirms the event. Keep the action available while
 * arrangements are outstanding. The refusal names every outstanding item. A disabled button cannot
 * say why. Show only the server's named refusal verbatim. Other failures use the generic text.
 */
export function ConfirmEventAction({ eventId, eventName }: { eventId: number; eventName: string }) {
  return (
    <EventTransitionAction
      eventName={eventName}
      run={() => confirmEvent({ data: { id: eventId } })}
      triggerLabel="Confirm event"
      pendingLabel="Confirming…"
      dialogTitle="Confirm event"
      dialogDescription={`This confirms ${eventName} once its venue and technical arrangements are in place, and notifies the Organiser and any registered attendees.`}
      actionLabel="Confirm"
      successMessage="Event confirmed. The Organiser and any registered attendees will be notified."
      failureMessage="Could not confirm this event. Try again."
      refusalHeading={CONFIRMATION_REFUSAL_HEADING}
      invalidateOnRefusal
    />
  );
}
