import { Field, FieldLabel } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { EquipmentBookingOption } from "#/features/equipment-requests/schema";
import { formatProposedWindow } from "#/features/event-requests/format";

/**
 * Name the buffered period first and the venue second. The trigger and the option rows truncate
 * their tail, so the period — the part that tells separate sessions apart — must lead.
 */
const bookingLabel = (booking: EquipmentBookingOption) =>
  `${formatProposedWindow({ start: booking.startsAt, end: booking.endsAt })} · ${booking.venueName}`;

/** Name the period and the venue, so separate sessions stay distinct. */
export function BookingSelect({
  id,
  bookings,
  value,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  bookings: EquipmentBookingOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const selected = bookings.find(booking => booking.id === value);
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>Session venue booking</FieldLabel>
      <Select
        value={value || null}
        onValueChange={next => onChange(next ?? "")}
        disabled={disabled || bookings.length === 0}
      >
        <SelectTrigger id={id} className="w-full min-w-0" aria-describedby={describedBy}>
          <SelectValue placeholder="Choose an active approved booking">
            {selected ? (
              <span className="min-w-0 flex-1 truncate">{bookingLabel(selected)}</span>
            ) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {bookings.map(booking => (
            <SelectItem key={booking.id} value={booking.id}>
              {bookingLabel(booking)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {bookings.length === 0 && (
        <p className="body-sm text-muted-foreground">No active approved venue bookings.</p>
      )}
    </Field>
  );
}
