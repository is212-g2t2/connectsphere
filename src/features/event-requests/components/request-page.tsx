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

/** Capturing a new event request as a draft. The route holds the role guard; this holds the view. */
export function EventRequestsPage() {
  // PTR-71: the saved row *is* the action's state, so the id the server assigned reaches the next
  // save as the run's `previous` argument rather than through a `setDraftId` call after the await.
  // Saving again therefore edits this draft instead of opening another one beside it, and it holds
  // for the rest of the sitting; resuming a draft in a *later* sitting is PTR-12.
  const [draft, saveDraft, saving] = useMutation<EventRequestDraftValues, EventRequestDraft>(
    async (values, previous) =>
      unwrapRefusal(
        await saveEventRequestDraft({ data: { ...values, id: previous?.id } }),
        SAVE_FAILED
      ),
    SAVE_FAILED
  );

  // PTR-13 submits by the id the save handed back, never by a payload the server has not stored.
  const [submission, submitDraft, submitting] = useMutation<number, EventRequestDraft>(
    async id => unwrapRefusal(await submitEventRequest({ data: { id } }), SUBMIT_FAILED),
    SUBMIT_FAILED
  );

  /**
   * Submitting saves first: the organiser may have typed since the last save, and the row the
   * server validates has to be the one on screen. Both refusals are rethrown for the form's error
   * map to render, since that is where the missing-field list belongs.
   */
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
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">
        {submitted ? "Event request submitted" : "New event request"}
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
          {/*
            Dropped for the duration of the save rather than merely left standing: `<output>` is an
            implicit live region, and re-announcing a repeat save needs the node to go away and come
            back. A rejected save leaves `status` at `"error"`, so the confirmation stays gone.
          */}
          {!saving && !submitting && draft.status === "success" && (
            <output className="mt-6 block text-sm font-medium text-foreground">Draft saved.</output>
          )}

          <div className="mt-10">
            <EventRequestForm
              onSave={async values => {
                // The action never rejects, so nothing here can strand an unhandled promise. The form owns its own submitting flag and error map, so a refusal is re-raised for its error map to render.
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
