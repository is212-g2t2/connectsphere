import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { NewVenuePage } from "#/features/venues/components/new-venue-page";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/venues/new")({
  head: () => createSeoHead({ title: "New venue — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { venue: ["create"] })) {
      throw redirect({ to: "/venues" });
    }
  },
  component: NewVenuePage,
});
