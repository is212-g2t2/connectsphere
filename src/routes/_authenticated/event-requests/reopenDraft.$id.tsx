import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { can } from "#/features/auth/permissions";
import { EventRequestsPage } from "#/features/event-requests/components/request-page";
import { EventRequestsPageSkeleton } from "#/features/event-requests/components/request-page-skeleton";
import { EventRequestIdInput } from "#/features/event-requests/schema";
import { getEventRequestDraft } from "#/features/event-requests/server-fns";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import type { RoomLayout } from "#/features/venues/schema";
import { listRoomLayouts } from "#/features/venues/server-fns";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/_authenticated/event-requests/reopenDraft/$id")({
  head: () =>
    createSeoHead({
      title: "Edit event request — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: async ({
    params,
  }): Promise<{ draft: EventRequestDraft; layouts: RoomLayout[] | undefined }> => {
    // Apply the server function's rule here. A malformed path segment returns 404 without a server call, as `$requestId.tsx` does.
    const parsed = EventRequestIdInput.safeParse({ id: Number(params.id) });
    if (!parsed.success) {
      throw notFound();
    }
    const { draft } = await getEventRequestDraft({ data: parsed.data });
    // Another organiser's row, a submitted request, or a missing id returns `null`.
    // None can be reopened, so each case returns 404.
    if (!draft) {
      throw notFound();
    }
    // The event form's room-layout preference offers the maintained list (PTR-161 AC1). A
    // failed read leaves the form on the initials, as `load-page-data.ts` does.
    const layouts = await listRoomLayouts().catch(() => undefined);
    return { draft, layouts };
  },
  component: () => {
    const { draft, layouts } = Route.useLoaderData();
    return <EventRequestsPage existingDraft={draft} layouts={layouts} />;
  },
  pendingComponent: EventRequestsPageSkeleton,
});
