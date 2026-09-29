import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EquipmentRequestSkeleton } from "#/features/equipment-requests/components/equipment-request-skeleton";
import { EquipmentReviewPage } from "#/features/equipment-requests/components/equipment-review-page";
import { EventRequestIdInput } from "#/features/event-requests/schema";
import { listEvents } from "#/features/events/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/equipment-requests/$eventId")({
  head: () => createSeoHead({ title: "Review equipment request — ConnectSphere", noindex: true }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { equipment_request: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({ params }) => {
    // The rule the server applies, so a junk path segment is a 404 without a round trip. An event
    // the member is not connected to, or one that does not exist, is the server's own refusal.
    const parsed = EventRequestIdInput.safeParse({ id: Number(params.eventId) });
    if (!parsed.success) throw notFound();
    const entry = (await listEvents({ data: { eventId: parsed.data.id } })).at(0);
    if (!entry) throw notFound();
    return entry.event;
  },
  component: () => <EquipmentReviewPage event={Route.useLoaderData()} />,
  pendingComponent: EquipmentRequestSkeleton,
});
