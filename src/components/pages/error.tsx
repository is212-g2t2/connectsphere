import * as Sentry from "@sentry/tanstackstart-react";
import * as React from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Page } from "#/components/layout/page";
import { RootDocument } from "#/components/layout/root-document";

interface ErrorPageProps {
  error: unknown;
  reset?: () => void;
  title?: string;
}

export function ErrorPage({ error, reset, title = "Something went wrong" }: ErrorPageProps) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <Page width="page">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center">
        <div className="w-full space-y-8 animate-in fade-in duration-500">
          <div className="space-y-3">
            <p className="eyebrow text-muted-foreground">Error</p>
            <h1 className="display-h1">{title}</h1>
          </div>

          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-card p-4 font-mono mono break-words whitespace-pre-wrap text-muted-foreground">
            {message}
          </pre>

          <div className="flex flex-col items-start gap-3">
            {reset && (
              <button
                type="button"
                onClick={reset}
                className="cursor-pointer label underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Try again
              </button>
            )}
            <a
              href="/"
              className="label underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    </Page>
  );
}

/**
 * The root route's error boundary. A boundary replaces everything beneath `<html>`, so it
 * re-renders the document shell itself, and it is the one place that reports the failure to
 * Sentry — on the server during SSR, and again on the client once it hydrates.
 */
export function RootErrorPage(props: ErrorComponentProps) {
  // Capture SSR rendering exceptions manually as per documentation
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

/** The root route's 404. Nothing to report — the address simply matched no route. */
export function RootNotFoundPage() {
  return (
    <RootDocument meta={<meta name="robots" content="noindex, nofollow" />}>
      <ErrorPage error="The page you are looking for does not exist." title="404 - Not Found" />
    </RootDocument>
  );
}
