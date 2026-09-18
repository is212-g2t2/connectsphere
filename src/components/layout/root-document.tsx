import { HeadContent, Scripts } from "@tanstack/react-router";

import { ThemeProvider } from "#/components/providers/theme-provider";
import { Toaster } from "#/components/ui/sonner";

/**
 * The HTML document every render is wrapped in — the root route's shell and the one the error
 * and not-found boundaries reuse, since a boundary replaces the whole tree beneath `<html>`.
 * It lives beside the header rather than in `src/routes/__root.tsx`, which keeps that file to
 * routing (PTR-75).
 */
export function RootDocument({
  children,
  meta,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
}) {
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
        <Toaster />
      </body>
    </html>
  );
}
