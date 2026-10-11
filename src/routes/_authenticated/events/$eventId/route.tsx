import { createFileRoute } from "@tanstack/react-router";

/**
 * Layout for this event's routes. It lets Organiser and Coordinator pages sit beside Attendee
 * pages without inheriting an Attendee-only `beforeLoad`. Each child route has its own guard.
 * Without a `component`, this route renders its `Outlet` (see `_authenticated.tsx`).
 */
export const Route = createFileRoute("/_authenticated/events/$eventId")({});
