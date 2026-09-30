import { useState } from "react";

import { Button } from "#/components/ui/button";
import { ReleaseEquipmentDialog } from "#/features/equipment-requests/components/release-equipment-dialog";
import type { ReleaseEquipmentDialogProps } from "#/features/equipment-requests/components/release-equipment-dialog";

/** The one Reduce or release button + dialog, shown beside Reserve on a line holding units. */
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
