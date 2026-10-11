/** Return the reserved-count suffix for a line with a reservation. */
export function ReservedCount({ quantity, className }: { quantity: number; className?: string }) {
  return <span className={className}> · {quantity} reserved</span>;
}
