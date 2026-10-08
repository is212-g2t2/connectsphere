import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Button } from "#/components/ui/button";
import { listEventRegistrations } from "#/features/events/server-fns";
import type { EventRegistrationRow } from "#/features/events/server-fns";

/** The server's named refusal for this list, worded for the caller. Any other fault is generic. */
const FORBIDDEN_MESSAGE = "You do not have permission to view these Attendees.";

function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message === "Forbidden" ? FORBIDDEN_MESSAGE : "";
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; attendees: EventRegistrationRow[] }
  | { status: "error"; message: string };

/**
 * PTR-48: the Attendees registered for an event, for its Organiser and its assigned Coordinator.
 * The list is read on the interaction that needs it — when the dialog opens — not from an effect,
 * matching `VipSearch.runSearch` in `vip-registrations.tsx`.
 */
export function AttendeeRegistrations({
  eventId,
  registeredCount,
}: {
  eventId: number;
  registeredCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

  async function load() {
    setState({ status: "loading" });
    try {
      const attendees = await listEventRegistrations({ data: { id: eventId } });
      setState({ status: "done", attendees });
    } catch (error) {
      setState({
        status: "error",
        message: refusalOf(error) || "Could not load the Attendees. Try again.",
      });
    }
  }

  const attendees = state.status === "done" ? state.attendees : null;
  const vips = attendees?.filter(attendee => attendee.vip) ?? [];
  const standard = attendees?.filter(attendee => !attendee.vip) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        setOpen(isOpen);
        if (isOpen) void load();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>View attendees</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attendees ({attendees ? attendees.length : registeredCount})</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {state.status === "error" ? (
            <p role="alert" className="body-sm text-destructive">
              {state.message}
            </p>
          ) : attendees === null ? (
            <p className="body-sm text-muted-foreground">Loading…</p>
          ) : attendees.length === 0 ? (
            <p className="body-sm text-muted-foreground">No Attendees are registered.</p>
          ) : (
            <>
              {vips.length > 0 && (
                <section aria-labelledby={`attendee-registrations-vips-${eventId}`}>
                  <p
                    id={`attendee-registrations-vips-${eventId}`}
                    className="body-sm font-medium text-primary"
                  >
                    VIP attendees ({vips.length})
                  </p>
                  <ul className="mt-3 space-y-3">
                    {vips.map(attendee => (
                      <li key={attendee.attendeeId} className="body-sm">
                        <p className="font-medium">{attendee.name || "Unnamed Attendee"}</p>
                        <p className="break-all text-muted-foreground">{attendee.email}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {standard.length > 0 && (
                <section aria-labelledby={`attendee-registrations-standard-${eventId}`}>
                  <p
                    id={`attendee-registrations-standard-${eventId}`}
                    className="body-sm font-medium"
                  >
                    Standard attendees ({standard.length})
                  </p>
                  <ul className="mt-3 space-y-3">
                    {standard.map(attendee => (
                      <li key={attendee.attendeeId} className="body-sm">
                        <p className="font-medium">{attendee.name || "Unnamed Attendee"}</p>
                        <p className="break-all text-muted-foreground">{attendee.email}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
