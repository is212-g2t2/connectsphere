import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "#/features/auth/components/settings-page";
import { listAccounts, unwrapRefusal } from "#/features/auth/session";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => createSeoHead({ title: "Settings — ConnectSphere", noindex: true }),
  loader: () => unwrapRefusal(listAccounts(), "Could not load your accounts. Try again."),
  component: () => (
    <SettingsPage user={Route.useRouteContext().user} accounts={Route.useLoaderData()} />
  ),
});
