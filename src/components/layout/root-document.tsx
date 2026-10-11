import { HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";

import { ThemeProvider } from "#/components/providers/theme-provider";
import { Toaster } from "#/components/ui/sonner";

/**
 * Wrap every render in this HTML document. The root route and error or not-found boundaries use it.
 * A boundary replaces everything below `<html>`, so it must render the document shell again.
 * Keep this beside the header. The route-module test limits `src/routes/__root.tsx` to routing (PTR-75).
 */
export function RootDocument({
  children,
  meta,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
}) {
  // This runs after React attaches, never during SSR. E2E tests can wait for `body[data-hydrated]` instead of network silence.
  // Network silence can occur before event handlers attach when the dev server transforms files on demand.
  useEffect(() => {
    document.body.dataset.hydrated = "true";
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {meta}
      </head>
      <body>
        <ThemeProvider defaultTheme="light" storageKey="connectsphere-theme">
          {children}
        </ThemeProvider>
        <Scripts />
        <Toaster richColors />
      </body>
    </html>
  );
}
