import { createFileRoute } from "@tanstack/react-router";

/**
 * The layout for one event's routes, and nothing else. It exists so the Organiser/Coordinator
 * attendee page can sit beside the Attendee event page without inheriting that page's
 * attendee-only `beforeLoad`: each child route carries its own guard. A route with no
 * `component` renders its `Outlet` (see `_authenticated.tsx`).
 */
export const Route = createFileRoute("/_authenticated/events/$eventId")({});
