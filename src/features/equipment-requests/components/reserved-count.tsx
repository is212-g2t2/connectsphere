/** The " · N reserved" suffix for a line holding a reservation. */
export function ReservedCount({ quantity, className }: { quantity: number; className?: string }) {
  return <span className={className}> · {quantity} reserved</span>;
}
