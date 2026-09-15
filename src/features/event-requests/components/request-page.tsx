import { Link } from "@tanstack/react-router";

import { unwrapRefusal } from "#/features/auth/session";
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
 */
function toDraftValues(row: EventRequestDraft): EventRequestDraftValues {
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
    async (values, previous) =>
      unwrapRefusal(
        await saveEventRequestDraft({
          data: { ...values, id: previous?.id ?? existingDraft?.id },
        }),
        SAVE_FAILED
      ),
    SAVE_FAILED
  );

  const [submission, submitDraft, submitting] = useMutation<number, EventRequestDraft>(
    async id => unwrapRefusal(await submitEventRequest({ data: { id } }), SUBMIT_FAILED),
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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/event-requests" className={NAV_LINK_CLASSNAME}>
        Back to event requests
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">
        {submitted
          ? "Event request submitted"
          : existingDraft
            ? "Edit event request"
            : "New event request"}
      </h1>
      {!submitted && (
        <p className="mt-3 max-w-xl text-muted-foreground">
          Save what you know now and finish the details later.
        </p>
      )}

      {submitted ? (
        <section className="mt-6 rounded-xl border border-border p-6">
          <output className="block text-sm font-medium text-foreground">Request submitted.</output>
          <p className="mt-3 text-sm text-muted-foreground">{SUBMITTED_EDIT_REFUSAL}</p>
        </section>
      ) : (
        <>
          {!saving && !submitting && draft.status === "success" && (
            <output className="mt-6 block text-sm font-medium text-foreground">Draft saved.</output>
          )}

          <div className="mt-10">
            <EventRequestForm
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
    </main>
  );
}
