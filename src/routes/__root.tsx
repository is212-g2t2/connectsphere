import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import { Header } from "#/components/layout/header";
import { RootDocument } from "#/components/layout/root-document";
import { RootErrorPage, RootNotFoundPage } from "#/components/pages/error";
import { getCurrentUser } from "#/features/auth/session";
// oxlint-disable-next-line import/no-unassigned-import
import "../globals.css";

export const Route = createRootRoute({
  /**
   * PTR-73: the one place the session is resolved, once per navigation, for every route —
   * `_authenticated` narrows what lands here rather than fetching it again. The header reads it
   * from context, so the signed-in nav is part of the SSR markup instead of appearing a moment
   * after hydration, which is what `authClient.useSession()` used to cost.
   */
  beforeLoad: async () => ({ user: await getCurrentUser() }),
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
        <TanStackDevtools
          plugins={[
            { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
            formDevtoolsPlugin(),
          ]}
        />
      )}
    </RootDocument>
  ),
  errorComponent: RootErrorPage,
  notFoundComponent: RootNotFoundPage,
});
