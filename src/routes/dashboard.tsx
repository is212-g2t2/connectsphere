import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { Upload, CheckCircle } from "lucide-react";
import { useState, useRef } from "react";

import { getCurrentUser } from "#/features/auth/session";
import { can } from "#/features/auth/permissions";
import { Button } from "#/components/ui/button";
import { createSeoHead } from "#/lib/seo";
import { cn, NAV_LINK_CLASSNAME } from "#/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () =>
    createSeoHead({
      title: "Dashboard — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();

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
            Your ConnectSphere home. Event, venue and equipment workspaces arrive with the stories
            that build them; what your role may do is enforced on the server either way.
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

        {can(user.role, { upload: ["create"] }) && <FileUploadCard />}

        <div className="mt-12 border-t border-border pt-6">
          <Link to="/settings" className={NAV_LINK_CLASSNAME}>
            Account settings
          </Link>
        </div>
      </section>
    </main>
  );
}

function FileUploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadedKey, setUploadedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setErrorMsg(null);

    try {
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

      setUploadedKey(key);
      setStatus("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setStatus("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="mt-12" aria-label="File upload">
      <h2 className="text-lg font-semibold">File upload</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Presigned PUT upload via MinIO. Images and PDFs up to 10 MB.
      </p>

      {status === "done" && uploadedKey ? (
        <p className="mt-4 flex items-center gap-2 text-sm">
          <CheckCircle className="size-4" />
          Uploaded: <code className="font-mono text-xs break-all">{uploadedKey}</code>
        </p>
      ) : status === "error" ? (
        <p className="mt-4 text-sm text-destructive">{errorMsg}</p>
      ) : null}

      <div className="mt-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,text/plain"
          className="hidden"
          onChange={e => void handleFileChange(e)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "uploading"}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {status === "uploading" ? "Uploading…" : "Choose file"}
        </Button>
      </div>
    </section>
  );
}
