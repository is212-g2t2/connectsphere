import { ReservedCount } from "#/features/equipment-requests/components/reserved-count";
import { arrangementStateLabel } from "#/features/equipment-requests/schema";

/** Technical Support's position on one line: its state, then the reason and note when present. */
export function ArrangementPosition({
  line,
}: {
  line: {
    arrangementStatus?: string;
    unavailableReason?: string | null;
    arrangementNotes?: string | null;
    reservedQuantity?: number | null;
  };
}) {
  return (
    <>
      {line.arrangementStatus && (
        <p className="mt-1 font-medium">
          State: {arrangementStateLabel(line.arrangementStatus)}
          {typeof line.reservedQuantity === "number" && (
            <ReservedCount quantity={line.reservedQuantity} className="text-muted-foreground" />
          )}
        </p>
      )}
      {line.unavailableReason && (
        <p className="mt-0.5 text-muted-foreground">{`Reason: ${line.unavailableReason}`}</p>
      )}
      {line.arrangementNotes && (
        <p className="mt-0.5 text-muted-foreground">
          {`Technical Support note: ${line.arrangementNotes}`}
        </p>
      )}
    </>
  );
}
