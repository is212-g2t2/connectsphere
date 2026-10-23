import * as Sentry from "@sentry/tanstackstart-react";
import * as React from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { RootDocument } from "#/components/layout/root-document";
import { buttonVariants } from "#/components/ui/button";
import { cn } from "#/lib/utils";

interface ErrorPageProps {
  error: unknown;
  reset?: () => void;
  title?: string;
  /** The human sentence under the title. Defaults to a generic recovery line. */
  description?: string;
}

export function ErrorPage({
  error,
  reset,
  title = "Something went wrong",
  description = "Something broke on our side. Try again, or head back to safety.",
}: ErrorPageProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <Page width="page">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center">
        <div className="animate-in fade-in duration-500">
          <PageHeader eyebrow="Error" title={title} description={description} />

          <div className="flex flex-wrap items-center gap-3">
            {reset && (
              <button type="button" onClick={reset} className={cn(buttonVariants())}>
                Try again
              </button>
            )}
            <a href="/" className={cn(buttonVariants({ variant: "secondary" }))}>
              Back to home
            </a>
            <a href="/dashboard" className={cn(buttonVariants({ variant: "ghost" }))}>
              Go to dashboard
            </a>
          </div>

          {import.meta.env.DEV ? (
            <details className="mt-8">
              <summary className="cursor-pointer label text-muted-foreground">
                Error details
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-card p-4 font-mono mono break-words whitespace-pre-wrap text-muted-foreground">
                {message}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

/**
 * The root route's error boundary. It replaces everything below `<html>`, so it renders the
 * document shell again. It also reports the error to Sentry during server rendering and after
 * client hydration.
 */
export function RootErrorPage(props: ErrorComponentProps) {
  // Capture SSR rendering exceptions as the docs instruct.
  if (typeof window === "undefined") {
    Sentry.captureException(props.error);
  }

  React.useEffect(() => {
    Sentry.captureException(props.error);
  }, [props.error]);

  return (
    <RootDocument meta={<meta name="robots" content="noindex, nofollow" />}>
      <ErrorPage error={props.error} reset={props.reset} />
    </RootDocument>
  );
}

/** The root route's 404. The address matched no route, so there is nothing else to report. */
export function RootNotFoundPage() {
  return (
    <RootDocument meta={<meta name="robots" content="noindex, nofollow" />}>
      <ErrorPage
        error="The page you are looking for does not exist."
        title="404 - Not Found"
        description="The page you are looking for does not exist."
      />
    </RootDocument>
  );
}
