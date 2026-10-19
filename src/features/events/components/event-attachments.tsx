import { useCallback, useEffect, useState } from "react";

import { listEventAttachments } from "#/features/events/server-fns";
import type { EventAttachmentList } from "#/features/events/server-fns";
import type { EventPageData, EventSectionDef } from "#/features/events/page-data";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const LOAD_FAILED = "Could not load the supporting documents. Try again.";

/** The download route for one event attachment. The route checks the allow-list per request. */
export function eventAttachmentDownloadUrl(eventId: number, attachmentId: number): string {
  return `/api/event-attachments?id=${eventId}&attachmentId=${attachmentId}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.message ? loadError.message : LOAD_FAILED);
    }
  }, [eventId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the attachment list lives on the server; the event id changing is the event that re-reads it
    void refresh();
  }, [refresh]);

  const attachments = listing?.attachments ?? [];

  return (
    <div>
      <h2 className="display-h3">Supporting documents</h2>
      <p className="mt-2 body-sm text-muted-foreground">
        Floor plans and programmes attached to this event.
      </p>

      {error && (
        <p role="alert" className="mt-4 body-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {listing !== null &&
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
                <span className="text-muted-foreground">{formatSize(attachment.sizeBytes)}</span>
                <a
                  href={eventAttachmentDownloadUrl(eventId, attachment.id)}
                  download={attachment.originalFilename}
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
