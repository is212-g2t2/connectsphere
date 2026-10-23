import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
import { DraftAttachments } from "#/features/event-requests/components/draft-attachments";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { SUBMITTED_EDIT_REFUSAL } from "#/features/event-requests/schema";
import { saveEventRequestDraft, submitEventRequest } from "#/features/event-requests/server-fns";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

const SAVE_FAILED = "Could not save this draft. Try again.";
const SUBMIT_FAILED = "Could not submit this request. Try again.";

/**
 * Create a draft or edit one loaded by the `$id` route. After reopening a draft, use its id on the
 * first save. `useMutation`'s `previous` value (PTR-71) carries an id only after a save in this
 * session. Without this fallback, the first save would insert a second row.
 *
 * `UpdateEventInformation` also uses this component. A request detail includes all draft fields
 * and relations, so it can be passed here as-is.
 */
export function toDraftValues(row: EventRequestDraft): EventRequestDraftValues {
  return {
    ...row,
    expectedAttendance: row.expectedAttendance ?? undefined,
    registrationCapacity: row.registrationCapacity ?? undefined,
    registrationOpensAt: row.registrationOpensAt ?? undefined,
    registrationClosesAt: row.registrationClosesAt ?? undefined,
  };
}
export function EventRequestsPage({ existingDraft }: { existingDraft?: EventRequestDraft } = {}) {
  const [draft, saveDraft, saving] = useMutation<EventRequestDraftValues, EventRequestDraft>(
    (values, previous) =>
      saveEventRequestDraft({
        data: { ...values, id: previous?.id ?? existingDraft?.id },
      }),
    SAVE_FAILED
  );

  const [submission, submitDraft, submitting] = useMutation<number, EventRequestDraft>(
    id => submitEventRequest({ data: { id } }),
    SUBMIT_FAILED
  );

  async function handleSubmitRequest(values: EventRequestDraftValues) {
    const saved = await saveDraft(values);
    if (saved.status !== "success") {
      throw new Error(saved.error ?? SAVE_FAILED);
    }

    const result = await submitDraft(saved.data.id);
    if (result.status !== "success") {
      throw new Error(result.error ?? SUBMIT_FAILED);
    }
  }

  const submitted = submission.status === "success";
  // Attachments need a saved row. A reopened draft has its id; a new draft gains one on save.
  const attachmentDraftId = draft.data?.id ?? existingDraft?.id;

  return (
    <Page width="page">
      <Link to="/event-requests" className={NAV_LINK_CLASSNAME}>
        Back to event requests
      </Link>

      <PageHeader
        title={
          submitted
            ? "Event request submitted"
            : existingDraft
              ? "Edit event request"
              : "New event request"
        }
        description={submitted ? undefined : "Save what you know now and finish the details later."}
      />

      {submitted ? (
        <Card className="mt-6">
          <CardContent>
            <output className="block body-sm font-medium text-foreground">
              Request submitted.
            </output>
            <p className="mt-3 body-sm text-muted-foreground">{SUBMITTED_EDIT_REFUSAL}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {!saving && !submitting && draft.status === "success" && (
            <output className="mt-6 block body-sm font-medium text-foreground">Draft saved.</output>
          )}

          <div className="mt-10">
            {/* Keep the draft fixed for this mount. The form derives `isDefaultValue` from its first values, so a reload must not replace them. */}
            <EventRequestForm
              key={existingDraft?.id ?? "new"}
              initialValues={existingDraft ? toDraftValues(existingDraft) : undefined}
              onSave={async values => {
                const { error } = await saveDraft(values);
                if (error) {
                  throw new Error(error);
                }
              }}
              onSubmitRequest={handleSubmitRequest}
            />
          </div>

          {attachmentDraftId !== undefined && (
            <DraftAttachments key={attachmentDraftId} draftId={attachmentDraftId} />
          )}
        </>
      )}
    </Page>
  );
}
