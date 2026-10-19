import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  EquipmentTypeFormInput,
  EquipmentUnavailabilityFormInput,
} from "#/features/equipment-requests/schema";
import type { EquipmentTypeOption } from "#/features/events/page-data";
import {
  deleteEquipmentType,
  saveEquipmentType,
  saveEquipmentUnavailability,
} from "#/features/equipment-requests/server-fns";
import { parseWholeNumber } from "#/features/event-requests/schema";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * PTR-162: Technical Support maintains the equipment catalogue. The loader supplies the types
 * with their held and out-of-service quantities, so the page renders without a router.
 */
export function EquipmentCataloguePage({ types }: { types: EquipmentTypeOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const refresh = async () => {
    await router.invalidate({ filter: skipRootFilter });
  };

  return (
    <Page width="page">
      <PageHeader
        title="Equipment catalogue"
        description="Add types and keep held and out-of-service quantities current. Availability uses the saved values."
      />

      <div className="flex items-center justify-between gap-4">
        <h2 className="display-h3">Types</h2>
        {editing === null && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            Add type
          </Button>
        )}
      </div>

      {types.length === 0 && editing === null && (
        <p className="mt-3 body-sm text-muted-foreground">No equipment types recorded yet.</p>
      )}

      {types.length > 0 && (
        <ul className="mt-4 space-y-4">
          {types.map(type =>
            editing === type.id ? (
              <li key={type.id} className="rounded-lg border border-border p-4">
                <TypeForm
                  initial={{ name: type.name, quantityHeld: String(type.quantityHeld) }}
                  typeId={type.id}
                  onDone={() => {
                    setEditing(null);
                    void refresh();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={type.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-medium">{type.name}</h3>
                    <p className="mt-1 body-sm text-muted-foreground">
                      {type.quantityHeld} held
                      {type.totalUnavailable > 0 && `, ${type.totalUnavailable} out of service`}
                    </p>
                    {type.unavailable.length > 0 && (
                      <ul className="mt-2 space-y-1 body-sm text-muted-foreground">
                        {type.unavailable.map(row => (
                          <li key={row.reason}>
                            {row.reason}: {row.quantityUnavailable} out of service
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(type.id)}>
                      Edit
                    </Button>
                    <DeleteTypeButton typeId={type.id} onDone={() => void refresh()} />
                  </div>
                </div>
                <UnavailabilityForm typeId={type.id} onDone={() => void refresh()} />
              </li>
            )
          )}
        </ul>
      )}

      {editing === "new" && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <TypeForm
            initial={{ name: "", quantityHeld: "" }}
            typeId={undefined}
            onDone={() => {
              setEditing(null);
              void refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
    </Page>
  );
}

function TypeForm({
  initial,
  typeId,
  onDone,
  onCancel,
}: {
  initial: { name: string; quantityHeld: string };
  typeId: number | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: EquipmentTypeFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await saveEquipmentType({
          data: {
            ...(typeId === undefined ? {} : { id: typeId }),
            name: value.name,
            quantityHeld: parseWholeNumber(value.quantityHeld),
          },
        });
        toast.success(typeId === undefined ? "Equipment type added." : "Equipment type saved.");
        onDone();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save this type. Try again.",
          },
        });
      }
    },
  });

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={e => {
        e.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="name">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`equipment-type-name-${typeId ?? "new"}`}>
                Type name (required)
              </FieldLabel>
              <Input
                id={`equipment-type-name-${typeId ?? "new"}`}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                required
                placeholder="e.g. Portable Projector"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="quantityHeld">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`equipment-type-held-${typeId ?? "new"}`}>
                Quantity held (required)
              </FieldLabel>
              <Input
                id={`equipment-type-held-${typeId ?? "new"}`}
                type="number"
                min={1}
                step={1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                required
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </div>
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>
      <div className="flex items-center gap-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : typeId === undefined ? "Add type" : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteTypeButton({ typeId, onDone }: { typeId: number; onDone: () => void }) {
  const [state, remove, removing] = useMutation(async () => {
    await deleteEquipmentType({ data: { id: typeId } });
    toast.success("Equipment type deleted.");
    onDone();
  }, "Could not delete this type. Try again.");

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant="ghost" size="sm" disabled={removing} onClick={() => void remove()}>
        {removing ? "Deleting…" : "Delete"}
      </Button>
      {state.status === "error" && (
        <span role="alert" className="body-sm text-destructive">
          {state.error}
        </span>
      )}
    </span>
  );
}

function UnavailabilityForm({ typeId, onDone }: { typeId: number; onDone: () => void }) {
  const form = useForm({
    defaultValues: { reason: "", quantityUnavailable: "" },
    validators: { onSubmit: EquipmentUnavailabilityFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await saveEquipmentUnavailability({
          data: {
            equipmentTypeId: typeId,
            reason: value.reason,
            quantityUnavailable: parseWholeNumber(value.quantityUnavailable),
          },
        });
        toast.success("Out-of-service quantity saved.");
        form.reset();
        onDone();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save. Try again.",
          },
        });
      }
    },
  });

  return (
    <form
      noValidate
      className="mt-3 space-y-3 border-t border-border pt-3"
      onSubmit={e => {
        e.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <p className="body-sm font-medium">Out-of-service units</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="reason">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`out-of-service-reason-${typeId}`}>Reason (required)</FieldLabel>
              <Input
                id={`out-of-service-reason-${typeId}`}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                placeholder="e.g. Maintenance"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="quantityUnavailable">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`out-of-service-qty-${typeId}`}>Quantity (required)</FieldLabel>
              <Input
                id={`out-of-service-qty-${typeId}`}
                type="number"
                min={1}
                step={1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </div>
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>
      <form.Subscribe selector={state => state.isSubmitting}>
        {isSubmitting => (
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save out-of-service units"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
