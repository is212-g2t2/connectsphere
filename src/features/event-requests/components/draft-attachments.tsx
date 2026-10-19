import { useCallback, useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
} from "#/features/event-requests/attachments";
import {
  downloadEventRequestAttachment,
  listEventRequestAttachments,
  removeEventRequestAttachment,
  uploadEventRequestAttachment,
} from "#/features/event-requests/server-fns";
import type { EventRequestAttachmentList } from "#/features/event-requests/server-fns";

const LOAD_FAILED = "Could not load the attachments. Try again.";
const UPLOAD_FAILED = "Could not attach this file. Try again.";
const DOWNLOAD_FAILED = "Could not download this file. Try again.";
const REMOVE_FAILED = "Could not remove this file. Try again.";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Decode base64 in slices so a 10 MB file never builds one giant intermediate string. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The draft's supporting documents (floor plans, programmes). Lists the organiser's files and
 * uploads and downloads them through server functions. Needs a saved draft id; the new-request
 * page mounts this after the first save. While storage is unconfigured the list still reads
 * and attaching reports unavailable, so the rest of the draft keeps working.
 */
export function DraftAttachments({ draftId }: { draftId: number }) {
  const [listing, setListing] = useState<EventRequestAttachmentList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setListing(await listEventRequestAttachments({ data: { id: draftId } }));
    } catch (refreshError) {
      setError(
        refreshError instanceof Error && refreshError.message ? refreshError.message : LOAD_FAILED
      );
    }
  }, [draftId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the attachment list lives on the server; the draft id changing is the event that re-reads it
    void refresh();
  }, [refresh]);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(ATTACHMENT_TOO_LARGE_MESSAGE);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("id", String(draftId));
      form.set("file", file);
      await uploadEventRequestAttachment({ data: form });
      await refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error && uploadError.message ? uploadError.message : UPLOAD_FAILED
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(attachmentId: number) {
    setDownloadingId(attachmentId);
    setError(null);
    try {
      const { filename, contentType, base64 } = await downloadEventRequestAttachment({
        data: { id: draftId, attachmentId },
      });
      const url = URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: contentType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error && downloadError.message
          ? downloadError.message
          : DOWNLOAD_FAILED
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleRemove(attachmentId: number) {
    setRemovingId(attachmentId);
    setError(null);
    try {
      await removeEventRequestAttachment({ data: { id: draftId, attachmentId } });
      await refresh();
    } catch (removeError) {
      setError(
        removeError instanceof Error && removeError.message ? removeError.message : REMOVE_FAILED
      );
    } finally {
      setRemovingId(null);
    }
  }

  const attachments = listing?.attachments ?? [];
  const storageAvailable = listing?.storageAvailable ?? true;

  return (
    <section aria-label="Supporting documents" className="mt-10 border-t border-border pt-6">
      <h3 className="display-h3">Supporting documents</h3>
      <p className="mt-2 body-sm text-muted-foreground">
        Attach floor plans and programmes as PDF, PNG, JPEG, or DOCX files up to 10 MB. The
        Coordinator receives them with the request.
      </p>

      {!storageAvailable && (
        <p className="mt-4 body-sm text-muted-foreground">
          {ATTACHMENT_STORAGE_UNAVAILABLE_MESSAGE}
        </p>
      )}

      {storageAvailable && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            const input = event.currentTarget.querySelector('input[type="file"]');
            const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
            void (async () => {
              await handleUpload(file);
              if (input instanceof HTMLInputElement) input.value = "";
            })();
          }}
        >
          <Input
            type="file"
            accept={ATTACHMENT_ACCEPT}
            aria-label="Choose a file to attach"
            disabled={uploading}
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" disabled={uploading}>
            {uploading ? "Attaching…" : "Attach file"}
          </Button>
        </form>
      )}

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
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={downloadingId === attachment.id}
                  onClick={() => void handleDownload(attachment.id)}
                >
                  {downloadingId === attachment.id ? "Downloading…" : "Download"}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={removingId === attachment.id}
                  onClick={() => void handleRemove(attachment.id)}
                >
                  {removingId === attachment.id ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        ))}

      {listing !== null && attachments.length > 0 && (
        <p className="mt-2 body-sm text-muted-foreground">
          {attachments.length} of {ATTACHMENT_MAX_COUNT} attachments used.
        </p>
      )}
    </section>
  );
}
