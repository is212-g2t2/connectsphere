import { Field, FieldLabel } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { EquipmentBookingOption } from "#/features/equipment-requests/schema";
import { formatLocalDateTime } from "#/features/event-requests/format";

const bookingLabel = (booking: EquipmentBookingOption) =>
  `${booking.venueName}: ${formatLocalDateTime(booking.startsAt)} to ${formatLocalDateTime(booking.endsAt)}`;

/** Name both the venue and the buffered period, so separate sessions stay distinct. */
export function BookingSelect({
  id,
  bookings,
  value,
  onChange,
  disabled,
}: {
  id: string;
  bookings: EquipmentBookingOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = bookings.find(booking => booking.id === value);
  return (
    <Field>
      <FieldLabel htmlFor={id}>Session venue booking</FieldLabel>
      <Select
        value={value || null}
        onValueChange={next => onChange(next ?? "")}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose an active approved booking">
            {selected ? bookingLabel(selected) : null}
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
