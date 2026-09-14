import { createRootRoute, Outlet } from "@tanstack/react-router";

import { Header } from "#/components/layout/header";
import { RootDocument } from "#/components/layout/root-document";
import { RootErrorPage, RootNotFoundPage } from "#/components/pages/error";
// oxlint-disable-next-line import/no-unassigned-import
import "../globals.css";

export const Route = createRootRoute({
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
    </RootDocument>
  ),
  errorComponent: RootErrorPage,
  notFoundComponent: RootNotFoundPage,
});
