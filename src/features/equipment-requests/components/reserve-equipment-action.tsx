import { useState } from "react";

import { Button } from "#/components/ui/button";
import { ReserveEquipmentDialog } from "#/features/equipment-requests/components/reserve-equipment-dialog";
import type { ReserveEquipmentDialogProps } from "#/features/equipment-requests/components/reserve-equipment-dialog";

/** The one Reserve button + dialog, shared by the workspace card and the review page. */
export function ReserveEquipmentAction({
  line,
}: {
  line: ReserveEquipmentDialogProps["equipmentRequest"];
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
      <ReserveEquipmentDialog equipmentRequest={line} open={open} onOpenChange={setOpen} />
    </>
  );
}
