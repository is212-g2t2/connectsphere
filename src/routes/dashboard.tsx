import { createFileRoute, redirect, useRouter, Link } from "@tanstack/react-router";
import { Trash2, Plus, Upload, CheckCircle } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";

import { getCurrentUser } from "#/features/auth/session";
import { listNotes, createNote, deleteNote } from "#/features/notes/server-fns";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { createSeoHead } from "#/lib/seo";

export const Route = createFileRoute("/dashboard")({
  head: () =>
    createSeoHead({
      title: "Dashboard — TanStack Start Template",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
  loader: async () => {
    const notes = await listNotes();
    return { notes };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { notes } = Route.useLoaderData();
  const router = useRouter();

  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDeleteNote(id: number) {
    setDeletingId(id);
    try {
      await deleteNote({ data: { id } });
      await router.invalidate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await createNote({ data: { title: newTitle } });
      setNewTitle("");
      await router.invalidate();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create note");
    } finally {
      setCreating(false);
    }
  }

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
            A protected route exercising the full loop: session, server functions, database,
            uploads.
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
              Notes
            </dt>
            <dd className="mt-2 text-lg font-medium">{notes.length}</dd>
          </div>
        </dl>

        <section className="mt-12" aria-label="Notes">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">Notes</h2>
          </div>

          <form onSubmit={e => void handleCreateNote(e)} className="mt-4 flex gap-2">
            <Input
              placeholder="New note title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={creating || !newTitle.trim()} size="sm">
              <Plus className="size-4" />
              Add
            </Button>
          </form>

          {notes.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No notes yet. Add your first one above.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="py-2 pr-4 text-left font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    Note
                  </th>
                  <th
                    scope="col"
                    className="py-2 pr-4 text-left font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    Created
                  </th>
                  <th
                    scope="col"
                    className="py-2 text-right font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  >
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.map(note => (
                  <tr key={note.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4">{note.title}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                      {note.createdAt ? new Date(note.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={deletingId === note.id}
                        aria-label={`Delete note: ${note.title}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleDeleteNote(note.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <FileUploadCard />

        <div className="mt-12 border-t border-border pt-6">
          <Link
            to="/settings"
            className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
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
