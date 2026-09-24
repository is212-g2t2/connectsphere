import { Link } from "@tanstack/react-router";

import { Page, PageHeader } from "#/components/layout/page";
import { Card, CardContent } from "#/components/ui/card";
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
 * Capturing a new draft, or continuing one loaded by the `$id` route. `existingDraft`'s id is the
 * fallback the *first* save after a reopen uses: `useMutation`'s own `previous` (PTR-71) only
 * carries an id across saves within this sitting, and starts undefined here since no save has
 * happened yet — without the fallback, the first save after reopening would insert a second row
 * instead of updating the one that was loaded.
 *
 * Exported for `EventRequestDetailPage`, whose reply form seeds the same shape; a request detail
 * carries every draft field plus its relations, so the row is assignable as-is.
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
            {/* The draft is fixed for this mount: the form derives `isDefaultValue` from the values
                it started with, so a save's reload must not reseed them underneath it. */}
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
        </>
      )}
    </Page>
  );
}
