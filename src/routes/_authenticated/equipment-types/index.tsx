import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EquipmentCataloguePage } from "#/features/equipment-requests/components/equipment-catalogue-page";
import { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/equipment-types/")({
  head: () => createSeoHead({ title: "Equipment catalogue — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { equipment_type: ["manage"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listEquipmentTypes(),
  component: () => <EquipmentCataloguePage types={Route.useLoaderData()} />,
});
