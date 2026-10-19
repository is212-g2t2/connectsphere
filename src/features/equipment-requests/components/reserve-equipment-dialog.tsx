import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { BookingSelect } from "#/features/equipment-requests/components/booking-select";
import type { EquipmentBookingOption } from "#/features/equipment-requests/schema";
import { ReserveEquipmentFormInput } from "#/features/equipment-requests/schema";
import { checkLineAvailability, reserveEquipment } from "#/features/equipment-requests/server-fns";
import { formatProposedWindow } from "#/features/event-requests/format";
import { parseWholeNumber } from "#/features/event-requests/schema";
import { skipRootFilter } from "#/lib/invalidate";

export interface ReserveEquipmentDialogProps {
  equipmentRequest: {
    id: string;
    item: string;
    quantity: number;
    reservedQuantity?: number | null;
    venueRequestId?: string | null;
  };
  bookings: EquipmentBookingOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Availability =
  | { status: "loading" }
  | { status: "unselected" }
  | { status: "ready"; available: number; startsAt: string; endsAt: string }
  | { status: "error"; error: string };

export function ReserveEquipmentDialog({
  equipmentRequest,
  bookings,
  open,
  onOpenChange,
}: ReserveEquipmentDialogProps) {
  const router = useRouter();
  const requested = equipmentRequest.quantity;
  const currentReserved = equipmentRequest.reservedQuantity ?? 0;
  const quantityId = `reserve-quantity-${equipmentRequest.id}`;
  const helpId = `${quantityId}-help`;
  const errorId = `${quantityId}-error`;

  const [availability, setAvailability] = useState<Availability>({ status: "loading" });
  const requestVersion = useRef(0);
  const [venueRequestId, setVenueRequestId] = useState(() =>
    bookings.some(booking => booking.id === equipmentRequest.venueRequestId)
      ? (equipmentRequest.venueRequestId ?? "")
      : bookings.length === 1
        ? bookings[0].id
        : ""
  );

  const refreshAvailability = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!venueRequestId) {
      setAvailability({ status: "unselected" });
      return;
    }
    setAvailability({ status: "loading" });
    try {
      const result = await checkLineAvailability({
        data: { equipmentRequestId: equipmentRequest.id, venueRequestId },
      });
      if (version === requestVersion.current) {
        setAvailability({
          status: "ready",
          available: result.availableQuantity,
          startsAt: result.period.startsAt,
          endsAt: result.period.endsAt,
        });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setAvailability({
          status: "error",
          error: error instanceof Error ? error.message : "Could not check availability.",
        });
      }
    }
  }, [equipmentRequest.id, venueRequestId]);

  const form = useForm({
    defaultValues: { quantity: String(requested) },
    // Use `ReserveEquipmentInput` rules. A blank or fractional quantity marks this input before
    // submit. The server caps the total at the line's requested quantity.
    validators: { onSubmit: ReserveEquipmentFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await reserveEquipment({
          data: {
            equipmentRequestId: equipmentRequest.id,
            venueRequestId,
            quantity: parseWholeNumber(value.quantity),
          },
        });
        if (result.arrangementStatus === "reserved") {
          toast.success(`Reserved all ${result.quantity} × ${equipmentRequest.item}.`);
        } else {
          toast.success(`Reserved ${result.quantity} of ${requested} — the line stays Requested.`);
        }
        onOpenChange(false);
        await router.invalidate({ filter: skipRootFilter });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not reserve equipment. Try again.";
        // Show the refusal on the quantity input, as for a validation error.
        formApi.setErrorMap({ onSubmit: { fields: { quantity: { message } }, form: message } });
        // Another member may have reserved units before this request. Read availability again.
        void refreshAvailability();
      }
    },
  });

  useEffect(() => {
    // Read availability when the dialog opens or its selected booking changes.
    // oxlint-disable-next-line react/set-state-in-effect -- opening the controlled dialog is the event that triggers the re-read
    void refreshAvailability();
  }, [refreshAvailability]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="min-w-0 space-y-4"
          noValidate
          onSubmit={event => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reserve equipment</DialogTitle>
            <DialogDescription>
              Choose the session this line serves. The period includes setup and turnaround time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <form.Subscribe selector={state => state.isSubmitting}>
              {isSubmitting => (
                <BookingSelect
                  id={`reserve-booking-${equipmentRequest.id}`}
                  bookings={bookings}
                  value={venueRequestId}
                  onChange={next => {
                    // Re-picking the same booking changes nothing, and the effect below would not re-run.
                    if (next === venueRequestId) return;
                    // Bump the version before the effect runs, so a reply for the last booking cannot write ready for this one.
                    requestVersion.current++;
                    // Clear the last window's answer at once, so its numbers and an enabled Confirm do not survive this render.
                    setAvailability({ status: "loading" });
                    setVenueRequestId(next);
                  }}
                  disabled={isSubmitting}
                />
              )}
            </form.Subscribe>
            <div className="rounded-md bg-muted p-3 body-sm">
              <div className="flex justify-between font-medium">
                <span>Item:</span>
                <span>{equipmentRequest.item}</span>
              </div>
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>Requested quantity:</span>
                <span>{requested}</span>
              </div>
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>Currently reserved:</span>
                <span>{currentReserved}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3 text-muted-foreground">
                <span>Availability:</span>
                {availability.status === "unselected" ? (
                  <span>
                    {bookings.length === 0 ? "—" : "Choose a booking to check availability."}
                  </span>
                ) : availability.status === "loading" ? (
                  <span aria-live="polite">Checking availability…</span>
                ) : availability.status === "ready" ? (
                  <span className="text-right">
                    {availability.available} unit{availability.available === 1 ? "" : "s"} available
                    for{" "}
                    {formatProposedWindow({
                      start: availability.startsAt,
                      end: availability.endsAt,
                    })}
                    {currentReserved > 0 ? " (excluding this line's current holding)." : "."}
                  </span>
                ) : (
                  <span role="alert" className="font-medium text-destructive">
                    {availability.error}
                  </span>
                )}
              </div>
            </div>

            <form.Subscribe selector={state => state.isSubmitting}>
              {isSubmitting => (
                <form.Field name="quantity">
                  {field => {
                    const invalid = field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={quantityId}>Total units to reserve</FieldLabel>
                        <Input
                          id={quantityId}
                          type="number"
                          min={1}
                          max={requested}
                          step={1}
                          value={field.state.value}
                          onChange={e => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          disabled={isSubmitting}
                          aria-invalid={invalid}
                          aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
                          required
                        />
                        <p id={helpId} className="caption text-muted-foreground">
                          The total held for this line. Reserving at least {requested} marks the
                          line Reserved; less keeps it Requested.
                        </p>
                        <FieldError id={errorId} errors={field.state.meta.errors} />
                      </Field>
                    );
                  }}
                </form.Field>
              )}
            </form.Subscribe>
          </div>

          <DialogFooter>
            <form.Subscribe selector={state => state.isSubmitting}>
              {isSubmitting => (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmitting || !venueRequestId || availability.status !== "ready"}
                  >
                    {isSubmitting ? "Reserving…" : "Confirm reservation"}
                  </Button>
                </>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
