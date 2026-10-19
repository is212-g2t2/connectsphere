import { useState } from "react";

import { Button } from "#/components/ui/button";
import { ReserveEquipmentDialog } from "#/features/equipment-requests/components/reserve-equipment-dialog";
import type { ReserveEquipmentDialogProps } from "#/features/equipment-requests/components/reserve-equipment-dialog";

/** The Reserve button and dialog used by the workspace card and review page. */
export function ReserveEquipmentAction({
  line,
  bookings,
}: {
  line: ReserveEquipmentDialogProps["equipmentRequest"];
  bookings: ReserveEquipmentDialogProps["bookings"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Reserve equipment for ${line.item}`}
      >
        Reserve
      </Button>
      {open && (
        <ReserveEquipmentDialog
          equipmentRequest={line}
          bookings={bookings}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
