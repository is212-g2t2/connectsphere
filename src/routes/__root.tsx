import * as React from "react";
import * as Sentry from "@sentry/tanstackstart-react";
import { Header } from "#/components/layout/header";
import { HeadContent, Scripts, createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { ErrorPage } from "#/components/pages/error";
import { Toaster } from "#/components/ui/sonner";
import { ThemeProvider } from "#/components/providers/theme-provider";
// oxlint-disable-next-line import/no-unassigned-import
import "../globals.css";

interface AppRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<AppRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        name: "theme-color",
        content: "#09090b",
      },
      {
        name: "color-scheme",
        content: "light dark",
      },
      {
        title: "TanStack Start Template",
      },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  errorComponent: props => {
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
  },
  notFoundComponent: () => {
    return (
      <RootDocument meta={<meta name="robots" content="noindex, nofollow" />}>
        <ErrorPage error="The page you are looking for does not exist." title="404 - Not Found" />
      </RootDocument>
    );
  },
});

function RootComponent() {
  return (
    <RootDocument>
      <Header />
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {meta}
      </head>
      <body>
        <ThemeProvider defaultTheme="light" storageKey="template-theme">
          {children}
        </ThemeProvider>
        <Scripts />
        <Toaster richColors />
      </body>
    </html>
  );
}
