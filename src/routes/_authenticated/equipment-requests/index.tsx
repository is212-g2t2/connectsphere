import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EquipmentRequestSkeleton } from "#/features/equipment-requests/components/equipment-request-skeleton";
import { EquipmentWorkListPage } from "#/features/equipment-requests/components/equipment-work-list-page";
import { listEvents } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/equipment-requests/")({
  head: () => createSeoHead({ title: "Equipment requests — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { equipment_request: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  // The events the member is connected to; for Technical Support that is the submitted requests.
  loader: () => listEvents({ data: {} }),
  component: () => <EquipmentWorkListPage events={Route.useLoaderData()} />,
  pendingComponent: EquipmentRequestSkeleton,
});
