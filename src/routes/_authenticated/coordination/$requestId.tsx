import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { CoordinationRequestPage } from "#/features/coordination/components/coordination-request-page";
import { CoordinationRequestPageSkeleton } from "#/features/coordination/components/coordination-request-page-skeleton";
import { getCoordinationRequest, listCoordinators } from "#/features/coordination/server-fns";
import { EventRequestIdInput } from "#/features/event-requests/schema";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/coordination/$requestId")({
  head: () => createSeoHead({ title: "Coordinate request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["coordinate"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }) => {
    // The same rule the server function applies, so a junk path segment is a 404 without a
    // round trip, as the sibling event-requests detail route does.
    const parsed = EventRequestIdInput.safeParse({ id: Number(params.requestId) });
    if (!parsed.success) {
      throw notFound();
    }
    const [request, coordinators] = await Promise.all([
      getCoordinationRequest({ data: parsed.data }),
      listCoordinators(),
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
  pendingComponent: CoordinationRequestPageSkeleton,
});
