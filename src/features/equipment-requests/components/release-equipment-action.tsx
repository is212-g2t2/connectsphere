import { useState } from "react";

import { Button } from "#/components/ui/button";
import { ReleaseEquipmentDialog } from "#/features/equipment-requests/components/release-equipment-dialog";
import type { ReleaseEquipmentDialogProps } from "#/features/equipment-requests/components/release-equipment-dialog";

/** Show the Reduce or release button and dialog beside Reserve on a line with held units. */
export function ReleaseEquipmentAction({
  line,
}: {
  line: ReleaseEquipmentDialogProps["equipmentRequest"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Reduce or release equipment for ${line.item}`}
      >
        Reduce or release
      </Button>
      <ReleaseEquipmentDialog equipmentRequest={line} open={open} onOpenChange={setOpen} />
    </>
  );
}
