import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { unwrapRefusal } from "#/features/auth/session";
import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import { getCoordinationRequest, listCoordinators } from "#/features/coordination/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/coordination/$requestId")({
  head: () => createSeoHead({ title: "Coordinate request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["coordinate"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // Ownership is always checked on navigation, including a return to a previously opened event.
  staleTime: 0,
  gcTime: 0,
  loader: async ({ params }) => {
    const [request, coordinators] = await Promise.all([
      unwrapRefusal(
        getCoordinationRequest({ data: { id: Number(params.requestId) } }),
        "Could not open this request."
      ),
      unwrapRefusal(listCoordinators(), "Could not load the Coordinators."),
    ]);
    return { request, coordinators };
  },
  component: () => (
    <CoordinationRequestPage
      key={Route.useLoaderData().request.id}
      {...Route.useLoaderData()}
      user={Route.useRouteContext().user}
    />
  ),
});
