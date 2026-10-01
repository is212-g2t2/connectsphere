import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EquipmentReviewSkeleton } from "#/features/equipment-requests/components/equipment-request-skeleton";
import { EquipmentReviewPage } from "#/features/equipment-requests/components/equipment-review-page";
import { listEquipmentTypes } from "#/features/equipment-requests/server-fns";
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
    // The refusal reaches the client as a plain Error (the class does not survive the server-function
    // boundary), so its fixed message is the only thing to match; anything else is a real fault.
    const [entries, equipmentTypes] = await Promise.all([
      listEvents({
        data: { eventId: parsed.data.id },
      }).catch((error: unknown) => {
        if (
          error instanceof Error &&
          (error.message === "Forbidden" || error.message === "Not Found")
        ) {
          throw notFound();
        }
        throw error;
      }),
      // A catalogue fault must not take the review page down; `null` lets the page say the list
      // could not be loaded, which an empty catalogue ([]) does not.
      listEquipmentTypes().catch(() => null),
    ]);
    const entry = entries.at(0);
    if (!entry) throw notFound();
    return { event: entry.event, access: entry.access, equipmentTypes };
  },
  component: () => <EquipmentReviewPage {...Route.useLoaderData()} />,
  pendingComponent: EquipmentReviewSkeleton,
});
