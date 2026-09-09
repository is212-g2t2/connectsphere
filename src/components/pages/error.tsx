import { cn } from "cn";

interface ErrorPageProps {
  error: unknown;
  reset?: () => void;
  className?: string;
  title?: string;
}

export function ErrorPage({
  error,
  reset,
  className,
  title = "Something went wrong",
}: ErrorPageProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div
      className={cn(
        "mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-16",
        className
      )}
    >
      <main className="w-full space-y-8 animate-in fade-in duration-500">
        <div className="space-y-3">
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Error
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            {title}
          </h1>
        </div>

        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {message}
        </pre>

        <div className="flex flex-col items-start gap-3">
          {reset && (
            <button
              type="button"
              onClick={reset}
              className="cursor-pointer text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Try again
            </button>
          )}
          <a
            href="/"
            className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Back to home
          </a>
        </div>
      </main>
    </div>
  );
}
