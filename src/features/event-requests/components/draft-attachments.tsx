import { useCallback, useEffect, useRef, useState } from "react";

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
import { formatAttachmentSize } from "#/features/event-requests/format";
import { useMutation } from "#/hooks/use-mutation";

const LOAD_FAILED = "Could not load the attachments. Try again.";
const UPLOAD_FAILED = "Could not attach this file. Try again.";
const DOWNLOAD_FAILED = "Could not download this file. Try again.";
const REMOVE_FAILED = "Could not remove this file. Try again.";
/** Keep the blob URL alive while the browser starts the transfer. Firefox and Safari need it. */
const DOWNLOAD_URL_LIFETIME_MS = 60_000;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** One `atob` call, then a byte copy. */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The draft's supporting documents (floor plans, programmes). Lists the organiser's files and
 * uploads, downloads and removes them through server functions. Needs a saved draft id; the
 * new-request page mounts this after the first save. While storage is unconfigured the list
 * still reads and attaching reports unavailable, so the rest of the draft keeps working.
 */
export function DraftAttachments({ draftId }: { draftId: number }) {
  const [listing, setListing] = useState<EventRequestAttachmentList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lastAction, setLastAction] = useState<"upload" | "download" | "remove" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setListing(await listEventRequestAttachments({ data: { id: draftId } }));
      setLoadError(null);
    } catch (refreshError) {
      setLoadError(messageOf(refreshError, LOAD_FAILED));
    }
  }, [draftId]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- the attachment list lives on the server; the draft id changing is the event that re-reads it
    void refresh();
  }, [refresh]);

  const [uploadState, upload, uploading] = useMutation<File>(async file => {
    const form = new FormData();
    form.set("id", String(draftId));
    form.set("file", file);
    await uploadEventRequestAttachment({ data: form });
    await refresh();
  }, UPLOAD_FAILED);

  const [downloadState, download, downloading] = useMutation<number>(async attachmentId => {
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
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  }, DOWNLOAD_FAILED);

  const [removeState, remove, removing] = useMutation<number>(async attachmentId => {
    await removeEventRequestAttachment({ data: { id: draftId, attachmentId } });
    await refresh();
  }, REMOVE_FAILED);

  async function handleRemove(attachmentId: number) {
    setFileError(null);
    setLastAction("remove");
    setRemovingId(attachmentId);
    try {
      await remove(attachmentId);
    } finally {
      setRemovingId(null);
    }
  }

  const attachments = listing?.attachments ?? [];
  const storageAvailable = listing?.storageAvailable ?? true;
  const atLimit = attachments.length >= ATTACHMENT_MAX_COUNT;
  const actionError =
    lastAction === "upload"
      ? uploadState.error
      : lastAction === "download"
        ? downloadState.error
        : lastAction === "remove"
          ? removeState.error
          : undefined;
  const error = fileError ?? actionError;

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

      {storageAvailable && !atLimit && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (!selectedFile) return;
            setFileError(null);
            setLastAction("upload");
            void (async () => {
              const result = await upload(selectedFile);
              if (result.status === "success") {
                setSelectedFile(null);
                if (fileInput.current) fileInput.current.value = "";
              }
            })();
          }}
        >
          <Input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            aria-label="Choose a file to attach"
            disabled={uploading}
            className="max-w-xs"
            onChange={event => {
              const file = event.currentTarget.files?.[0] ?? null;
              if (file && file.size > ATTACHMENT_MAX_BYTES) {
                setFileError(ATTACHMENT_TOO_LARGE_MESSAGE);
                setSelectedFile(null);
                return;
              }
              setFileError(null);
              setSelectedFile(file);
            }}
          />
          <Button type="submit" variant="outline" disabled={uploading || !selectedFile}>
            {uploading ? "Attaching…" : "Attach file"}
          </Button>
        </form>
      )}

      {loadError && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role="alert" className="body-sm font-medium text-destructive">
            {loadError}
          </p>
          <Button type="button" variant="link" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
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
                <span className="text-muted-foreground">
                  {formatAttachmentSize(attachment.sizeBytes)}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  aria-label={`Download ${attachment.originalFilename}`}
                  disabled={downloading}
                  onClick={() => {
                    setFileError(null);
                    setLastAction("download");
                    void download(attachment.id);
                  }}
                >
                  Download
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  aria-label={`Remove ${attachment.originalFilename}`}
                  disabled={removing}
                  onClick={() => void handleRemove(attachment.id)}
                >
                  {removingId === attachment.id ? "Removing…" : "Remove"}
                </Button>
              </li>
            ))}
          </ul>
        ))}

      {listing !== null && (
        <p className="mt-2 body-sm text-muted-foreground">
          {attachments.length} of {ATTACHMENT_MAX_COUNT} attachments used.
        </p>
      )}
    </section>
  );
}
