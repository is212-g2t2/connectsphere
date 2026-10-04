import { useEffect } from "react";
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
import { Textarea } from "#/components/ui/textarea";
import { ReleaseEquipmentFormInput } from "#/features/equipment-requests/schema";
import { releaseEquipment } from "#/features/equipment-requests/server-fns";
import { parseWholeNumber } from "#/features/event-requests/schema";

export interface ReleaseEquipmentDialogProps {
  equipmentRequest: {
    id: string;
    item: string;
    quantity: number;
    reservedQuantity?: number | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Whether the entered total gives the reservation back outright (0 units kept). */
function isFullRelease(quantity: string): boolean {
  const kept = parseWholeNumber(quantity);
  return Number.isInteger(kept) && kept === 0;
}

/** The submit button says what will happen, so a full release is never a neutral "confirm". */
function submitLabel(quantity: string, currentReserved: number): string {
  if (isFullRelease(quantity)) {
    return `Release all ${currentReserved} unit${currentReserved === 1 ? "" : "s"}`;
  }
  const kept = Number(quantity);
  if (Number.isInteger(kept) && kept > 0 && kept < currentReserved) {
    return `Keep ${kept} unit${kept === 1 ? "" : "s"}, release ${currentReserved - kept}`;
  }
  return "Confirm change";
}

/**
 * PTR-42: give back some or all of a line's reserved units. The total kept defaults to zero (a
 * full release); anything above zero and below the current holding is a reduction. A reason marks
 * the line unavailable instead of requested — Technical Support's call, never inferred — and
 * goes with a full release only, so an unavailable line never sits on units nobody can touch.
 */
export function ReleaseEquipmentDialog({
  equipmentRequest,
  open,
  onOpenChange,
}: ReleaseEquipmentDialogProps) {
  const router = useRouter();
  const requested = equipmentRequest.quantity;
  const currentReserved = equipmentRequest.reservedQuantity ?? 0;
  const quantityId = `release-quantity-${equipmentRequest.id}`;
  const reasonId = `release-reason-${equipmentRequest.id}`;
  const helpId = `${quantityId}-help`;
  const errorId = `${quantityId}-error`;
  const reasonHelpId = `${reasonId}-help`;
  const reasonErrorId = `${reasonId}-error`;

  const form = useForm({
    defaultValues: { quantity: "0", unavailableReason: "" },
    // The same gate as `ReleaseEquipmentInput`; the server refuses a total at or above the
    // current holding, so the input's max only guides.
    validators: { onSubmit: ReleaseEquipmentFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await releaseEquipment({
          data: {
            equipmentRequestId: equipmentRequest.id,
            quantity: parseWholeNumber(value.quantity),
            unavailableReason: value.unavailableReason,
          },
        });
        const state = result.arrangementStatus === "unavailable" ? "Unavailable" : "Requested";
        const change = result.released
          ? `Released all ${result.previousQuantity} × ${equipmentRequest.item} — the line is ${state}.`
          : `Reduced ${equipmentRequest.item} from ${result.previousQuantity} to ${result.quantity} — the line is ${state}.`;
        const notice = result.notificationQueued
          ? "The Coordinator will be notified."
          : "No Coordinator to notify; tell them yourself.";
        toast.success(`${change} ${notice}`);
        onOpenChange(false);
        await router.invalidate();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not release equipment. Try again.";
        formApi.setErrorMap({ onSubmit: { fields: { quantity: { message } }, form: message } });
      }
    },
  });

  useEffect(() => {
    // The dialog stays mounted while closed; each opening starts from a full release.
    if (open) form.reset();
  }, [open, form]);

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
            <DialogTitle>Reduce or release equipment</DialogTitle>
            <DialogDescription>
              Units given back are available to other events at once and are recorded on the line.
              The event&apos;s status does not change; its Coordinator is emailed.
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
            </div>

            <form.Subscribe selector={state => state.isSubmitting}>
              {isSubmitting => (
                <>
                  <form.Field name="quantity">
                    {field => {
                      const invalid = field.state.meta.errors.length > 0;
                      return (
                        <Field data-invalid={invalid}>
                          <FieldLabel htmlFor={quantityId}>Units to keep reserved</FieldLabel>
                          <Input
                            id={quantityId}
                            type="number"
                            min={0}
                            max={Math.max(currentReserved - 1, 0)}
                            step={1}
                            value={field.state.value}
                            onChange={e => {
                              const next = e.target.value;
                              field.handleChange(next);
                              if (!isFullRelease(next)) {
                                field.form.setFieldValue("unavailableReason", "");
                              }
                            }}
                            onBlur={field.handleBlur}
                            disabled={isSubmitting}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
                            required
                          />
                          <p id={helpId} className="caption text-muted-foreground">
                            {currentReserved > 1
                              ? `0 releases the reservation. 1 to ${currentReserved - 1} keeps that many reserved and releases the rest.`
                              : "This line holds one unit, so 0 releases it; there is nothing to reduce to."}
                          </p>
                          <FieldError id={errorId} errors={field.state.meta.errors} />
                        </Field>
                      );
                    }}
                  </form.Field>
                  <form.Field name="unavailableReason">
                    {field => {
                      const invalid = field.state.meta.errors.length > 0;
                      return (
                        <form.Subscribe selector={state => state.values.quantity}>
                          {quantity => {
                            const fullRelease = isFullRelease(quantity);
                            return (
                              <Field data-invalid={invalid}>
                                <FieldLabel htmlFor={reasonId}>
                                  Reason the line is unavailable (optional)
                                </FieldLabel>
                                <Textarea
                                  id={reasonId}
                                  rows={2}
                                  value={field.state.value}
                                  onChange={e => field.handleChange(e.target.value)}
                                  onBlur={field.handleBlur}
                                  disabled={isSubmitting || !fullRelease}
                                  aria-invalid={invalid}
                                  aria-describedby={
                                    invalid ? `${reasonHelpId} ${reasonErrorId}` : reasonHelpId
                                  }
                                />
                                <p id={reasonHelpId} className="caption text-muted-foreground">
                                  {fullRelease
                                    ? "Leave blank and the line returns to Requested. A reason marks it Unavailable, which goes with a full release (0 units kept)."
                                    : "A reason goes with a full release only — keep 0 units to mark the line Unavailable."}
                                </p>
                                <FieldError id={reasonErrorId} errors={field.state.meta.errors} />
                              </Field>
                            );
                          }}
                        </form.Subscribe>
                      );
                    }}
                  </form.Field>
                </>
              )}
            </form.Subscribe>
          </div>

          <DialogFooter>
            <form.Subscribe selector={state => state.values.quantity}>
              {quantity => (
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
                        {isSubmitting ? "Releasing…" : submitLabel(quantity, currentReserved)}
                      </Button>
                    </>
                  )}
                </form.Subscribe>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
