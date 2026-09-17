import { Link } from "@tanstack/react-router";
import { Upload, CheckCircle } from "lucide-react";
import { useRef } from "react";

import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import { useMutation } from "#/hooks/use-mutation";
import { Button } from "#/components/ui/button";
import { cn, NAV_LINK_CLASSNAME } from "#/lib/utils";
import type { EventProjection } from "#/features/events/access";
import { EventWorkspace } from "#/features/events/components/event-workspace";

const UPLOAD_FAILED = "Upload failed";

/**
 * The signed-in home view. The session user and the connected events arrive as props rather than
 * through `Route.useRouteContext()` so the page renders in a unit test without a router (PTR-75),
 * and the events come from the dashboard loader, which calls the `listEvents` server function.
 */
export function DashboardPage({ user, events }: { user: SessionUser; events: EventProjection[] }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <section className="flex flex-col">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Dashboard
          </p>
          <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Welcome, {user.name?.trim() || user.email}
          </h1>
          <p className="mt-3 max-w-xl text-muted-foreground">
            Your ConnectSphere home. Events and requests are filtered by your role and relationship
            to each event; server-side checks enforce the same boundary for direct requests.
          </p>
        </div>

        <dl className="mt-10 grid gap-6 border-y border-border py-6 sm:grid-cols-3">
          <div>
            <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Session
            </dt>
            <dd className="mt-2 text-lg font-medium">Active</dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Email
            </dt>
            <dd className="mt-2 truncate text-lg font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Role
            </dt>
            <dd className="mt-2 truncate text-lg font-medium">{user.role ?? "attendee"}</dd>
          </div>
        </dl>

        {can(user.role, { event_request: ["create"] }) && (
          <Link to="/event-requests" className={cn("mt-8 w-fit", NAV_LINK_CLASSNAME)}>
            Event requests
          </Link>
        )}

        {can(user.role, { event_request: ["coordinate"] }) && (
          <Link to="/coordination" className={cn("mt-8 w-fit", NAV_LINK_CLASSNAME)}>
            Coordination
          </Link>
        )}

        {can(user.role, { venue: ["read"] }) && (
          <Link to="/venues" className={cn("mt-8 w-fit", NAV_LINK_CLASSNAME)}>
            Venues
          </Link>
        )}

        {can(user.role, { venue: ["read"] }) && (
          <Link to="/venues/availability" className={cn("mt-8 w-fit", NAV_LINK_CLASSNAME)}>
            Venue calendar
          </Link>
        )}

        {can(user.role, { upload: ["create"] }) && <FileUploadCard />}

        <EventWorkspace events={events} />

        <div className="mt-12 border-t border-border pt-6">
          <Link to="/settings" className={NAV_LINK_CLASSNAME}>
            Account settings
          </Link>
        </div>
      </section>
    </main>
  );
}

/** One caller — the dashboard itself — so it stays in this file, per AGENTS.md. */
function FileUploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);

  // PTR-71: one action instead of a `status`/`uploadedKey`/`errorMsg` trio that had to be moved
  // in step. The two stages are one run, so a failed PUT cannot leave a key on screen from the
  // presign that preceded it, and React queues a second pick behind the first rather than racing
  // it — the concurrency the three flags could not express.
  const [upload, uploadFile, uploading] = useMutation(async (file: File) => {
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to get upload URL");
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const { url, key } = (await res.json()) as {
      url: string;
      key: string;
    };

    const putRes = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!putRes.ok) throw new Error("Upload to storage failed");

    return key;
  }, UPLOAD_FAILED);

  return (
    <section className="mt-12" aria-label="File upload">
      <h2 className="text-lg font-semibold">File upload</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Presigned PUT upload via MinIO. Images and PDFs up to 10 MB.
      </p>

      {uploading ? null : upload.status === "success" ? (
        <p className="mt-4 flex items-center gap-2 text-sm">
          <CheckCircle className="size-4" />
          Uploaded: <code className="font-mono text-xs break-all">{upload.data}</code>
        </p>
      ) : upload.status === "error" ? (
        <p className="mt-4 text-sm text-destructive">{upload.error}</p>
      ) : null}

      <div className="mt-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,text/plain"
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0];
            // Cleared before the run rather than after it, so picking the same file twice still
            // fires a `change`; the action, not the input, is what the UI reads from now.
            event.target.value = "";
            if (file) void uploadFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {uploading ? "Uploading…" : "Choose file"}
        </Button>
      </div>
    </section>
  );
}
