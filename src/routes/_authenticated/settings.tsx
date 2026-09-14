import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "#/features/auth/components/settings-page";
import { listAccounts } from "#/features/auth/session";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => createSeoHead({ title: "Settings — ConnectSphere", noindex: true }),
  loader: () => listAccounts(),
  component: () => (
    <SettingsPage user={Route.useRouteContext().user} accounts={Route.useLoaderData()} />
  ),
});
