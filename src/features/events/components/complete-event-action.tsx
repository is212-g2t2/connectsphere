import { useState } from "react";

import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  ACTUAL_ATTENDANCE_MESSAGE,
  ATTENDANCE_MAX,
  parseWholeNumber,
} from "#/features/event-requests/schema";
import { COMPLETION_REFUSAL_HEADING } from "#/features/events/completion";
import { completeEvent } from "#/features/events/server-fns";
import { EventTransitionAction } from "#/features/events/components/event-transition-action";

/**
 * PTR-25: The assigned Coordinator explicitly closes an event after it ends.
 * PTR-157 AC1: they can record actual attendance, a whole number of zero or more. Blank means none.
 */
export function CompleteEventAction({
  eventId,
  eventName,
  disabledReason,
}: {
  eventId: number;
  eventName: string;
  disabledReason?: string | null;
}) {
  const [attendance, setAttendance] = useState("");
  const trimmed = attendance.trim();
  const parsed = trimmed === "" ? null : parseWholeNumber(trimmed);
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed > ATTENDANCE_MAX);

  return (
    <EventTransitionAction
      eventName={eventName}
      disabledReason={disabledReason}
      run={() =>
        completeEvent({
          data: { id: eventId, ...(trimmed === "" ? {} : { actualAttendance: Number(trimmed) }) },
        })
      }
      triggerLabel="Complete event"
      pendingLabel="Completing…"
      dialogTitle={`Complete ${eventName}`}
      dialogDescription={`Mark ${eventName} as completed after its scheduled end time. Completed events no longer accept new bookings, equipment reservations, or registrations, and this cannot be undone.`}
      dialogExtra={
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="complete-attendance">Actual attendance (optional)</FieldLabel>
          <Input
            id="complete-attendance"
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 42"
            value={attendance}
            aria-invalid={invalid}
            onChange={event => setAttendance(event.target.value)}
          />
          <FieldError errors={invalid ? [{ message: ACTUAL_ATTENDANCE_MESSAGE }] : []} />
        </Field>
      }
      canSubmit={!invalid}
      actionLabel="Complete"
      successMessage="Event completed."
      failureMessage="Could not complete this event. Try again."
      refusalHeading={COMPLETION_REFUSAL_HEADING}
    />
  );
}
