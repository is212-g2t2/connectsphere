import { Badge } from "#/components/ui/badge";

/**
 * PTR-36: Flag a pending request that overlaps an approved booking or an active hold. Approval
 * refuses such a request, so the badge uses the `stopped` pill. Every page draws it the same way.
 */
export function ConflictBadge({ conflict }: { conflict: "booking" | "hold" }) {
  return (
    <Badge variant="stopped">
      {conflict === "hold" ? "Conflicting hold" : "Conflicting booking"}
    </Badge>
  );
}
