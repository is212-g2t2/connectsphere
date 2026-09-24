import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { clarificationAmendmentKeys } from "#/features/event-requests/schema";
import type { ClarificationField, EventRequestDraftValues } from "#/features/event-requests/schema";
import { replyToClarification } from "#/features/event-requests/server-fns";

type ReplyableClarification = {
  id: number;
  permittedFields: readonly ClarificationField[];
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
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function sendReply(replyBody: string, replyAmendments: Record<string, unknown>) {
    if (saved) return;

    setDeliveryWarning(null);

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
    if (result.notification === "sent") {
      toast.success("Reply sent — the Coordinator has been notified.");
    } else {
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
  }

  return (
    <>
      <EventRequestForm
        initialValues={initialValues}
        editableFields={clarification.permittedFields}
        idPrefix={`clarification-${clarification.id}`}
        saveLabel={saved ? "Reply sent" : "Send reply"}
        busyLabel="Sending…"
        disabled={saved}
        replyBody={{ label: "Your reply" }}
        onSave={async (values, { changedFields, replyBody }) => {
          await sendReply(
            replyBody,
            pickAmendments(values, clarification.permittedFields, changedFields)
          );
        }}
      />
      {deliveryWarning && (
        <output className="body-sm text-muted-foreground">{deliveryWarning}</output>
      )}
    </>
  );
}

/**
 * What a reply changes: one amendment per permitted field the organiser actually touched. A field
 * left at its loaded value is omitted, so a reply to a later question cannot resend the page-load
 * snapshot and revert an earlier reply's amendment. `attendeeRegistration` is one question spanning
 * four columns, so any of its fields changing sends all four as a group.
 */
function pickAmendments(
  values: EventRequestDraftValues,
  permittedFields: readonly ClarificationField[],
  changedFields: readonly string[]
): Record<string, unknown> {
  const changed = new Set(changedFields);
  const amendments: Record<string, unknown> = {};

  for (const field of permittedFields) {
    const keys = clarificationAmendmentKeys(field);
    if (!keys.some(key => changed.has(key))) continue;

    if (field === "attendeeRegistration") {
      amendments.registrationEnabled = values.registrationEnabled;
      amendments.registrationCapacity = values.registrationCapacity ?? null;
      amendments.registrationOpensAt = values.registrationOpensAt ?? null;
      amendments.registrationClosesAt = values.registrationClosesAt ?? null;
      continue;
    }

    amendments[field] = values[field] ?? null;
  }

  return amendments;
}
