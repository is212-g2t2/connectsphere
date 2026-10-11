import { Suspense } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";

import { Devtools } from "#/components/devtools";
import { Header } from "#/components/layout/header";
import { RootDocument } from "#/components/layout/root-document";
import { RootErrorPage, RootNotFoundPage } from "#/components/pages/error";
import { getSessionContext } from "#/features/auth/session";
// oxlint-disable-next-line import/no-unassigned-import
import "../globals.css";

export const Route = createRootRoute({
  /**
   * PTR-73: Resolve the session once on each full load. `_authenticated` checks it here instead of fetching it again.
   * The header reads the user from context, so signed-in navigation appears in server-rendered markup.
   * Load the unread count with the session; the notification bell needs no second request.
   * The root match stays active during sibling client navigation. The count updates on full loads
   * and `router.invalidate()`, not on each navigation.
   */
  beforeLoad: () => getSessionContext(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f6f6f4" },
      { name: "color-scheme", content: "light dark" },
      { title: "ConnectSphere" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: () => (
    <RootDocument>
      <Header />
      <Outlet />
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <Devtools />
        </Suspense>
      )}
    </RootDocument>
  ),
  errorComponent: RootErrorPage,
  notFoundComponent: RootNotFoundPage,
});
