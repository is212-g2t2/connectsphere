import type { ReactNode } from "react";

/** One labelled row inside a card's description list. Shared by the event views. */
export function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 font-medium text-foreground">{value}</dd>
    </div>
  );
}
