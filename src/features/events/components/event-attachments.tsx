import { useCallback, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { EVENT_ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE } from "#/features/event-requests/attachments";
import { formatAttachmentSize } from "#/features/event-requests/format";
import { listEventAttachments } from "#/features/events/server-fns";
import type { EventAttachmentList } from "#/features/events/server-fns";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const LOAD_FAILED = "Could not load the supporting documents. Try again.";

/** The download route for one event attachment. The route checks the allow-list per request. */
export function eventAttachmentDownloadUrl(eventId: number, attachmentId: number): string {
  return `/api/event-attachments?id=${eventId}&attachmentId=${attachmentId}`;
}

/**
 * The event's supporting documents for the attachment allow-list: the owning Organiser, the
 * assigned Coordinator, a Lead, or a Safety Officer reviewing it. Every other access reads no
 * section. The server refuses anyone else with the same response as a missing event.
 */
export function eventAttachmentSections(data: EventPageData): EventSectionDef[] {
  if (data.kind === "triage") {
    const { id } = data.request;
    return [
      {
        id: "attachments",
        label: "Supporting documents",
        visible: () => true,
        render: () => <EventAttachments eventId={id} />,
      },
    ];
  }
  switch (data.event.access) {
    case "organiser":
    case "coordinator":
    case "lead":
    case "safety_officer": {
      const { id } = data.event.event;
      return [
        {
          id: "attachments",
          label: "Supporting documents",
          visible: () => true,
          render: () => <EventAttachments eventId={id} />,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * List an event's supporting documents as read-only downloads. Each download is an anchor to
 * the download route, which serves the bytes as an attachment after its own allow-list check.
 */
export function EventAttachments({ eventId }: { eventId: number }) {
  const [listing, setListing] = useState<EventAttachmentList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setListing(await listEventAttachments({ data: { id: eventId } }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : LOAD_FAILED);
    }
  }, [eventId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the attachment list lives on the server; the event id changing is the event that re-reads it
    void refresh();
  }, [refresh]);

  const attachments = listing?.attachments ?? [];
  const storageAvailable = listing?.storageAvailable ?? true;

  return (
    <div>
      <h2 className="display-h3">Supporting documents</h2>
      <p className="mt-2 body-sm text-muted-foreground">
        Floor plans and programmes for this event.
      </p>

      {!storageAvailable && (
        <p className="mt-4 body-sm text-muted-foreground">
          {EVENT_ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE}
        </p>
      )}

      {error && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role="alert" className="body-sm font-medium text-destructive">
            {error}
          </p>
          <Button type="button" variant="link" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}

      {listing === null && !error && (
        <p className="mt-4 body-sm text-muted-foreground">Loading supporting documents…</p>
      )}

      {listing !== null &&
        storageAvailable &&
        (attachments.length === 0 ? (
          <p className="mt-4 body-sm text-muted-foreground">No supporting documents yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {attachments.map(attachment => (
              <li
                key={attachment.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 body-sm"
              >
                <span className="font-medium text-foreground">{attachment.originalFilename}</span>
                <span className="text-muted-foreground">
                  {formatAttachmentSize(attachment.sizeBytes)}
                </span>
                <a
                  href={eventAttachmentDownloadUrl(eventId, attachment.id)}
                  download={attachment.originalFilename}
                  aria-label={`Download ${attachment.originalFilename}`}
                  className={NAV_LINK_CLASSNAME}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
