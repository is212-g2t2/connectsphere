import { useState } from "react";
import { useForm } from "@tanstack/react-form";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
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
import { RoomLayoutInput, RoomLayoutKeyInput } from "#/features/venues/schema";

/**
 * Maintain the room layout list. Venue Staff add a type with a key and a label, rename one by
 * saving its key with a new label, and delete one that no venue supports. The loader supplies
 * the list, so a new type appears in the venue form, the search filter, and suitability at once.
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
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const form = useForm({
    defaultValues: { key: "", label: "" },
    validators: { onSubmit: RoomLayoutInput },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        const saved = await saveRoomLayout({ data: RoomLayoutInput.parse(value) });
        setLayouts(previous =>
          previous.some(layout => layout.key === saved.key)
            ? previous.map(layout => (layout.key === saved.key ? saved : layout))
            : [...previous, saved].toSorted((left, right) => left.label.localeCompare(right.label))
        );
        formApi.reset();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save this layout.");
      }
    },
  });

  async function rename(key: string) {
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
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Could not rename this layout.");
    }
  }

  async function remove(key: string) {
    setRowError(null);
    try {
      await deleteRoomLayout({ data: RoomLayoutKeyInput.parse({ key }) });
      setLayouts(previous => previous.filter(layout => layout.key !== key));
      if (editing === key) setEditing(null);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : "Could not delete this layout.");
    }
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
            className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={event => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="key">
              {field => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Key</FieldLabel>
                  <Input
                    id={field.name}
                    value={field.state.value}
                    placeholder="cabaret"
                    onChange={event => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
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

      <section aria-label="Layout types" className="mt-8">
        <h2 className="display-h3">Layout types</h2>
        {rowError && (
          <p role="alert" className="body-sm mt-2 text-destructive">
            {rowError}
          </p>
        )}
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {layouts.map(layout => (
              <TableRow key={layout.key}>
                <TableCell>{layout.key}</TableCell>
                <TableCell>
                  {editing === layout.key ? (
                    <Input
                      aria-label={`Label for ${layout.key}`}
                      value={draftLabel}
                      onChange={event => setDraftLabel(event.target.value)}
                    />
                  ) : (
                    layout.label
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-2">
                    {editing === layout.key ? (
                      <>
                        <Button type="button" size="sm" onClick={() => void rename(layout.key)}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(layout.key);
                            setDraftLabel(layout.label);
                            setRowError(null);
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void remove(layout.key)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </Page>
  );
}
