import { COMPLETION_REFUSAL_HEADING } from "#/features/events/completion";
import { completeEvent } from "#/features/events/server-fns";
import { EventTransitionAction } from "#/features/events/components/event-transition-action";

/** PTR-25: the assigned Coordinator explicitly closes an event after it ends. */
export function CompleteEventAction({
  eventId,
  eventName,
  disabledReason,
}: {
  eventId: number;
  eventName: string;
  disabledReason?: string | null;
}) {
  return (
    <EventTransitionAction
      eventName={eventName}
      disabledReason={disabledReason}
      run={() => completeEvent({ data: { id: eventId } })}
      triggerLabel="Complete event"
      pendingLabel="Completing…"
      dialogTitle={`Complete ${eventName}`}
      dialogDescription={`Mark ${eventName} as completed after its scheduled end time. Completed events no longer accept new bookings, equipment reservations, or registrations, and this cannot be undone.`}
      actionLabel="Complete"
      successMessage="Event completed."
      failureMessage="Could not complete this event. Try again."
      refusalHeading={COMPLETION_REFUSAL_HEADING}
    />
  );
}
