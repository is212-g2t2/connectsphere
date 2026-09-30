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
import { ReserveEquipmentFormInput } from "#/features/equipment-requests/schema";
import { checkLineAvailability, reserveEquipment } from "#/features/equipment-requests/server-fns";
import { formatLocalDateTime } from "#/features/event-requests/format";
import { parseWholeNumber } from "#/features/event-requests/schema";

export interface ReserveEquipmentDialogProps {
  equipmentRequest: {
    id: string;
    item: string;
    quantity: number;
    reservedQuantity?: number | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Availability =
  | { status: "loading" }
  | { status: "ready"; available: number; startsAt: string; endsAt: string }
  | { status: "error"; error: string };

export function ReserveEquipmentDialog({
  equipmentRequest,
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
  const cancelledRef = useRef(false);

  const refreshAvailability = useCallback(async () => {
    setAvailability({ status: "loading" });
    try {
      const result = await checkLineAvailability({
        data: { equipmentRequestId: equipmentRequest.id },
      });
      if (!cancelledRef.current) {
        setAvailability({
          status: "ready",
          available: result.availableQuantity,
          startsAt: result.period.startsAt,
          endsAt: result.period.endsAt,
        });
      }
    } catch (error) {
      if (!cancelledRef.current) {
        setAvailability({
          status: "error",
          error: error instanceof Error ? error.message : "Could not check availability.",
        });
      }
    }
  }, [equipmentRequest.id]);

  const form = useForm({
    defaultValues: { quantity: String(requested) },
    // The same gate as `ReserveEquipmentInput`, so a blank or fractional quantity marks its own
    // input before any request; the server caps the total at the line's requested quantity.
    validators: { onSubmit: ReserveEquipmentFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await reserveEquipment({
          data: {
            equipmentRequestId: equipmentRequest.id,
            quantity: parseWholeNumber(value.quantity),
          },
        });
        if (result.arrangementStatus === "reserved") {
          toast.success(`Reserved all ${result.quantity} × ${equipmentRequest.item}.`);
        } else {
          toast.success(`Reserved ${result.quantity} of ${requested} — the line stays Requested.`);
        }
        onOpenChange(false);
        await router.invalidate();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not reserve equipment. Try again.";
        // The refusal marks the quantity itself, the same place a validation issue lands.
        formApi.setErrorMap({ onSubmit: { fields: { quantity: { message } }, form: message } });
        // A failed submit may have raced another reservation, so the shown number is re-read
        // rather than left to sit stale under the error.
        void refreshAvailability();
      }
    },
  });

  useEffect(() => {
    cancelledRef.current = false;
    if (open) {
      // The dialog stays mounted while closed, so reopening never remounts the form: reset it so
      // each attempt starts from the requested total, and re-read availability because other
      // members may have moved it since the last look.
      form.reset();
      // oxlint-disable-next-line react/set-state-in-effect -- opening the controlled dialog is the event that triggers the re-read
      void refreshAvailability();
    }
    return () => {
      cancelledRef.current = true;
    };
  }, [open, form, refreshAvailability]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
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
              Reserving records the current approved venue booking period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
                {availability.status === "loading" ? (
                  <span aria-live="polite">Checking availability…</span>
                ) : availability.status === "ready" ? (
                  <span className="text-right">
                    {availability.available} unit{availability.available === 1 ? "" : "s"} available
                    for {formatLocalDateTime(availability.startsAt)} to{" "}
                    {formatLocalDateTime(availability.endsAt)}
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
                  <Button type="submit" size="sm" disabled={isSubmitting}>
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
