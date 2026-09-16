import { Skeleton } from "#/components/ui/skeleton";

function DetailSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-4 w-full" />
    </div>
  );
}

/**
 * The request detail's loading shape (PTR-16): back link, title with its status pill, the
 * assignment panel and the recorded fields, mirroring `CoordinationRequestPage`.
 */
export function CoordinationRequestPageSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16" aria-busy="true">
      <output className="sr-only">Loading this request…</output>

      <Skeleton className="h-4 w-44" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />

      <section className="mt-8 rounded-lg border border-border p-6">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-md" />
        <Skeleton className="mt-5 h-4 w-40" />
        <Skeleton className="mt-1 h-9 w-full" />
        <div className="mt-3 flex flex-wrap gap-3">
          <Skeleton className="h-9 w-44 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>
      </section>

      <dl className="mt-10 grid gap-6 sm:grid-cols-2">
        <DetailSkeleton />
        <DetailSkeleton />
        <DetailSkeleton wide />
        <DetailSkeleton wide />
        <DetailSkeleton />
        <DetailSkeleton />
        <DetailSkeleton wide />
        <DetailSkeleton wide />
      </dl>
    </main>
  );
}
