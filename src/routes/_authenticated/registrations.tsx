import { createFileRoute, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { RegistrationListPage } from "#/features/events/components/registration-list-page";
import { RegistrationListPageSkeleton } from "#/features/events/components/registration-list-page-skeleton";
import { listAttendeeRegistrations } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/registrations")({
  head: () => createSeoHead({ title: "My registrations — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event: ["register"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => listAttendeeRegistrations(),
  pendingComponent: RegistrationListPageSkeleton,
  component: () => <RegistrationListPage registrations={Route.useLoaderData()} />,
});
