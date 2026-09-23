import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Textarea } from "#/components/ui/textarea";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { CLARIFICATION_REPLY_MAX } from "#/features/event-requests/schema";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import { replyToClarification } from "#/features/event-requests/server-fns";

type ReplyableClarification = {
  id: number;
  permittedFields: readonly string[];
};

export function ClarificationReplyForm({
  requestId,
  clarification,
  initialValues,
}: {
  requestId: number;
  clarification: ReplyableClarification;
  initialValues?: EventRequestDraftValues;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canSubmit = body.trim().length > 0 && !isSaving && !saved;

  async function sendReply(replyBody: string, replyAmendments: Record<string, unknown>) {
    if (isSaving || saved) return;

    setError(null);
    setDeliveryWarning(null);
    setIsSaving(true);

    try {
      const result = await replyToClarification({
        data: {
          id: requestId,
          clarificationId: clarification.id,
          body: replyBody.trim(),
          amendments: replyAmendments,
        },
      });

      // The mutation committed even if a route reload has a transient failure. Lock this form so
      // retrying the browser action cannot create a second reply while the page is stale.
      setSaved(true);
      if (result.notification === "failed") {
        const message = "Your reply was saved, but ConnectSphere could not notify the Coordinator.";
        setDeliveryWarning(message);
        toast.warning(message);
      }

      try {
        await router.invalidate();
      } catch {
        if (result.notification !== "failed") {
          const message = "Your reply was saved. Refresh this page to see the updated request.";
          setDeliveryWarning(message);
          toast.warning(message);
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function submit() {
    if (!canSubmit) return;
    try {
      await sendReply(body, {});
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : "Could not send reply. Try again."
      );
    }
  }

  const replyField = (
    <Field>
      <FieldLabel htmlFor={`clarification-reply-${clarification.id}`}>Your reply</FieldLabel>
      <Textarea
        id={`clarification-reply-${clarification.id}`}
        className="mt-2"
        rows={4}
        maxLength={CLARIFICATION_REPLY_MAX}
        value={body}
        disabled={isSaving || saved}
        onChange={event => setBody(event.target.value)}
        required
      />
    </Field>
  );

  if (clarification.permittedFields.length > 0 && initialValues) {
    return (
      <EventRequestForm
        initialValues={initialValues}
        editableFields={clarification.permittedFields}
        idPrefix={`clarification-${clarification.id}`}
        saveLabel="Send reply"
        beforeFields={replyField}
        afterFields={
          deliveryWarning && (
            <output className="body-sm text-muted-foreground">{deliveryWarning}</output>
          )
        }
        onSave={async values => {
          if (!body.trim()) throw new Error("Enter your reply");
          await sendReply(body, pickAmendments(values, clarification.permittedFields));
        }}
      />
    );
  }

  return (
    <form
      noValidate
      className="mt-5 space-y-4"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      {replyField}
      <Button type="submit" disabled={!canSubmit}>
        {isSaving ? "Sending…" : saved ? "Reply sent" : "Send reply"}
      </Button>
      {error && <FieldError role="alert">{error}</FieldError>}
      {deliveryWarning && (
        <output className="body-sm text-muted-foreground">{deliveryWarning}</output>
      )}
    </form>
  );
}

function pickAmendments(
  values: EventRequestDraftValues,
  permittedFields: readonly string[]
): Record<string, unknown> {
  const amendments: Record<string, unknown> = {};

  for (const field of permittedFields) {
    switch (field) {
      case "eventName":
      case "purpose":
      case "proposedDates":
      case "expectedAttendance":
      case "equipmentRequirements":
        amendments[field] = values[field] ?? null;
        break;
      case "description":
      case "eventType":
      case "venueRequirements":
      case "roomLayoutPreference":
      case "accessibilityRequirements":
      case "specialArrangements":
        amendments[field] = values[field];
        break;
      case "attendeeRegistration":
        amendments.registrationEnabled = values.registrationEnabled;
        amendments.registrationCapacity = values.registrationCapacity ?? null;
        amendments.registrationOpensAt = values.registrationOpensAt ?? null;
        amendments.registrationClosesAt = values.registrationClosesAt ?? null;
        break;
    }
  }

  return amendments;
}
