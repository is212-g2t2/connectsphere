import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Button } from "#/components/ui/button";
import { listEventRegistrations } from "#/features/events/server-fns";

export function AttendeeRegistrations({
  eventId,
  registeredCount,
}: {
  eventId: number;
  registeredCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [attendees, setAttendees] = useState<
    { attendeeId: string; name: string; email: string; vip: boolean; registeredAt: string }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && attendees === null && !error) {
      listEventRegistrations({ data: { id: eventId } })
        .then(res => {
          setAttendees(res);
          return null;
        })
        .catch(err => {
          setError(err.message || "Failed to load attendees");
        });
    }
  }, [open, eventId, attendees, error]);

  const vips = attendees?.filter(a => a.vip) ?? [];
  const standard = attendees?.filter(a => !a.vip) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        setOpen(isOpen);
        if (isOpen) {
          setAttendees(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>View Attendees</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attendees ({attendees ? attendees.length : registeredCount})</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : attendees === null ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : attendees.length === 0 ? (
            <p className="text-muted-foreground text-sm">No attendees registered.</p>
          ) : (
            <>
              {vips.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 text-primary">
                    VIP Attendees ({vips.length})
                  </h4>
                  <ul className="space-y-2">
                    {vips.map(attendee => (
                      <li key={attendee.attendeeId} className="text-sm">
                        <span className="font-medium">{attendee.name || "Unnamed Attendee"}</span>
                        <br />
                        <span className="text-muted-foreground">{attendee.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {standard.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">
                    Standard Attendees ({standard.length})
                  </h4>
                  <ul className="space-y-2">
                    {standard.map(attendee => (
                      <li key={attendee.attendeeId} className="text-sm">
                        <span className="font-medium">{attendee.name || "Unnamed Attendee"}</span>
                        <br />
                        <span className="text-muted-foreground">{attendee.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
