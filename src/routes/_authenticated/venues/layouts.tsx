import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { RoomLayoutsPage } from "#/features/venues/components/room-layouts-page";
import { listRoomLayouts } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/layouts")({
  head: () => createSeoHead({ title: "Room layouts — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["update"] })) {
      throw redirect({ to: "/venues" });
    }
  },
  loader: async () => ({ layouts: await listRoomLayouts() }),
  component: () => (
    <RoomLayoutsPage user={Route.useRouteContext().user} initial={Route.useLoaderData().layouts} />
  ),
});
