import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Pencil, Trash2 } from "lucide-react";
import { z } from "zod";

import { Page, PageHeader } from "#/components/layout/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { IconAction } from "#/components/ui/icon-action";
import { Card, CardContent } from "#/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { SessionUser } from "#/features/auth/session";
import { deleteRoomLayout, saveRoomLayout } from "#/features/venues/server-fns";
import type { RoomLayout } from "#/features/venues/schema";
import {
  ROOM_LAYOUT_KEY_MAX_LENGTH,
  RoomLayoutInput,
  RoomLayoutKeyInput,
} from "#/features/venues/schema";

/** The add form holds a label alone. The submit derives the key from it. */
const LabelFormInput = z.object({ label: RoomLayoutInput.shape.label });

/**
 * Derive a layout key from its label: lowercase words joined with single hyphens. A label
 * with no letters or digits yields no key, and the form refuses it with a readable message.
 */
export function layoutKeyForLabel(label: string): string {
  return label
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, ROOM_LAYOUT_KEY_MAX_LENGTH)
    .replace(/-+$/, "");
}

/**
 * Maintain the room layout list. Venue Staff add a type with a label and rename one inline.
 * The key derives from the label, so only the label shows. The loader supplies the list, so
 * a new type appears in the venue form, the search filter, and suitability at once.
 */
export function RoomLayoutsPage({
  user: _user,
  initial,
}: {
  user: SessionUser;
  initial: readonly RoomLayout[];
}) {
  const [layouts, setLayouts] = useState<readonly RoomLayout[]>(initial);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [savingRow, setSavingRow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoomLayout | null>(null);
  const [deleting, setDeleting] = useState(false);

  // The add submit closes over the first render, so read the current list through a ref.
  const layoutsRef = useRef(layouts);
  useEffect(() => {
    layoutsRef.current = layouts;
  }, [layouts]);

  const form = useForm({
    defaultValues: { label: "" },
    validators: { onSubmit: LabelFormInput },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        const label = value.label.trim();
        const key = layoutKeyForLabel(label);
        if (key === "") {
          throw new Error("Use letters or numbers in the label so a key can be derived from it.");
        }
        const existing = layoutsRef.current.find(layout => layout.key === key);
        if (existing) {
          if (existing.label === label) {
            setNotice(`Layout type "${label}" is already listed.`);
            formApi.reset();
            return;
          }
          throw new Error(
            "A layout with this key already exists. Rename the existing layout instead."
          );
        }
        const saved = await saveRoomLayout({ data: RoomLayoutInput.parse({ key, label }) });
        setLayouts(previous =>
          previous.some(layout => layout.key === saved.key)
            ? previous.map(layout => (layout.key === saved.key ? saved : layout))
            : [...previous, saved].toSorted((left, right) => left.label.localeCompare(right.label))
        );
        setNotice(`Layout type "${saved.label}" added.`);
        formApi.reset();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save this layout.");
      }
    },
  });

  async function rename(key: string) {
    setSavingRow(true);
    setRowError(null);
    try {
      const saved = await saveRoomLayout({
        data: RoomLayoutInput.parse({ key, label: draftLabel }),
      });
      setLayouts(previous =>
        previous
          .map(layout => (layout.key === saved.key ? saved : layout))
          .toSorted((left, right) => left.label.localeCompare(right.label))
      );
      setEditing(null);
      setNotice(`Layout type renamed to "${saved.label}".`);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Could not rename this layout.");
    } finally {
      setSavingRow(false);
    }
  }

  async function remove(layout: RoomLayout) {
    setDeleting(true);
    setRowError(null);
    try {
      await deleteRoomLayout({ data: RoomLayoutKeyInput.parse({ key: layout.key }) });
      setLayouts(previous => previous.filter(item => item.key !== layout.key));
      if (editing === layout.key) setEditing(null);
      setConfirmDelete(null);
      setNotice(`Layout type "${layout.label}" deleted.`);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Could not delete this layout.");
    } finally {
      setDeleting(false);
    }
  }

  function startRename(layout: RoomLayout) {
    setEditing(layout.key);
    setDraftLabel(layout.label);
    setRowError(null);
  }

  function renderActions(layout: RoomLayout) {
    if (editing === layout.key) {
      return (
        <>
          <Button
            type="button"
            size="sm"
            disabled={savingRow}
            onClick={() => void rename(layout.key)}
          >
            {savingRow ? "Saving…" : "Save name"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={savingRow}
            onClick={() => setEditing(null)}
          >
            Cancel
          </Button>
        </>
      );
    }
    return (
      <>
        <IconAction label="Rename" icon={<Pencil />} onClick={() => startRename(layout)} />
        <IconAction
          label="Delete"
          icon={<Trash2 />}
          tone="danger"
          onClick={() => {
            setRowError(null);
            setConfirmDelete(layout);
          }}
        />
      </>
    );
  }

  return (
    <Page width="page">
      <PageHeader
        title="Room layouts"
        description="Add, rename, and delete the layout types that venues offer."
      />

      <Card>
        <CardContent>
          <h2 className="display-h3">Add a layout type</h2>
          <form
            noValidate
            className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
            onSubmit={event => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="label">
              {field => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Label</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    placeholder="Cabaret"
                    onChange={event => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Subscribe selector={state => state.isSubmitting}>
              {isSubmitting => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Adding…" : "Add layout"}
                </Button>
              )}
            </form.Subscribe>
          </form>
          {formError && (
            <p role="alert" className="body-sm mt-3 text-destructive">
              {formError}
            </p>
          )}
        </CardContent>
      </Card>

      {notice && (
        <output className="mt-6 block body-sm font-medium text-foreground">{notice}</output>
      )}

      <section aria-label="Layout types" className="mt-8">
        <h2 className="display-h3">Layout types</h2>
        {rowError && confirmDelete === null && (
          <p role="alert" className="body-sm mt-2 text-destructive">
            {rowError}
          </p>
        )}
        {layouts.length === 0 ? (
          <Empty className="mt-4">
            <EmptyHeader>
              <EmptyTitle>No layout types yet</EmptyTitle>
              <EmptyDescription>Add the first layout type with the form above.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table className="mt-4 hidden sm:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {layouts.map(layout => (
                  <TableRow key={layout.key}>
                    <TableCell>
                      {editing === layout.key ? (
                        <Input
                          aria-label={`New label for ${layout.label}`}
                          value={draftLabel}
                          disabled={savingRow}
                          onChange={event => setDraftLabel(event.target.value)}
                        />
                      ) : (
                        layout.label
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-2">{renderActions(layout)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="mt-4 space-y-3 sm:hidden">
              {layouts.map(layout => (
                <li key={layout.key}>
                  <Card>
                    <CardContent>
                      {editing === layout.key ? (
                        <Input
                          aria-label={`New label for ${layout.label}`}
                          value={draftLabel}
                          disabled={savingRow}
                          onChange={event => setDraftLabel(event.target.value)}
                        />
                      ) : (
                        <p className="font-medium">{layout.label}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">{renderActions(layout)}</div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={open => {
          if (!open && !deleting) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this layout type?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete
                ? `This deletes "${confirmDelete.label}". A layout that venues offer cannot be deleted. The refusal names those venues.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {rowError && (
            <p role="alert" className="body-sm text-destructive">
              {rowError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="sm"
              disabled={deleting || confirmDelete === null}
              onClick={() => {
                if (confirmDelete) void remove(confirmDelete);
              }}
            >
              {deleting ? "Deleting…" : "Delete layout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
