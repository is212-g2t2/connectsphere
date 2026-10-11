import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { pickAmendments } from "#/features/event-requests/amendments";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import type { ClarificationField, EventRequestDraftValues } from "#/features/event-requests/schema";
import { replyToClarification } from "#/features/event-requests/server-fns";
import { skipRootFilter } from "#/lib/invalidate";

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

    await replyToClarification({
      data: {
        id: requestId,
        clarificationId: clarification.id,
        body: replyBody.trim(),
        amendments: replyAmendments,
      },
    });

    // The reply is committed even if the route reload fails. Lock this form so a retry cannot
    // create a second reply from stale data. The same transaction queues the Coordinator's email,
    // so only the route reload can fail here.
    setSaved(true);
    toast.success("Reply sent — the Coordinator will be notified.");

    try {
      await router.invalidate({ filter: skipRootFilter });
    } catch {
      const message = "Your reply was saved. Refresh this page to see the updated request.";
      setDeliveryWarning(message);
      toast.warning(message);
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
