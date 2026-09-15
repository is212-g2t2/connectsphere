import { getRouteApi } from "@tanstack/react-router";

import { EventRequestsPage } from "#/features/event-requests/components/request-page";

const routeApi = getRouteApi("/_authenticated/event-request/reopenDraft/$id");

export function EditEventRequestPage() {
  const draft = routeApi.useLoaderData();

  return <EventRequestsPage existingDraft={draft} />;
}
