import { useRef, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import { Badge } from "#/components/ui/badge";
import type { RegisteredAttendee } from "#/features/events/access";
import { listEventRegistrations } from "#/features/events/server-fns";

export function AttendeeRegistrations({ eventId }: { eventId: number }) {
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [attendees, setAttendees] = useState<RegisteredAttendee[]>([]);
  // Only the latest expand may show its answer, so a slow older response never
  // replaces a newer one when the accordion is reopened in quick succession.
  const latest = useRef(0);

  async function handleValueChange(value: string[]) {
    if (!value.includes("attendees")) return;
    latest.current += 1;
    const mine = latest.current;
    setStatus("loading");
    try {
      const res = await listEventRegistrations({ data: { id: eventId } });
      if (mine !== latest.current) return;
      setAttendees(res);
      setStatus("done");
    } catch {
      if (mine !== latest.current) return;
      setStatus("error");
    }
  }

  return (
    <Accordion defaultValue={[]} onValueChange={value => void handleValueChange(value)}>
      <AccordionItem value="attendees">
        <AccordionTrigger>
          {status === "done" ? `Attendees (${attendees.length})` : "Attendees"}
        </AccordionTrigger>
        <AccordionContent>
          {status === "error" ? (
            <p role="alert" className="body-sm text-destructive">
              Could not load the attendee list. Reopen to try again.
            </p>
          ) : status === "loading" ? (
            <p className="body-sm text-muted-foreground">Loading…</p>
          ) : attendees.length === 0 ? (
            <p className="body-sm text-muted-foreground">No attendees registered.</p>
          ) : (
            <ul className="space-y-3">
              {attendees.map(attendee => (
                <li key={attendee.attendeeId} className="body-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {attendee.name || "Unnamed attendee"}
                    {attendee.vip && <Badge>VIP</Badge>}
                  </p>
                  <p className="break-all text-muted-foreground">{attendee.email}</p>
                </li>
              ))}
            </ul>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
