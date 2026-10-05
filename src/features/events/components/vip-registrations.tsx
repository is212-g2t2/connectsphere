import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import type { VipAttendee } from "#/features/events/access";
import {
  EVENT_FULL_MESSAGE,
  NOT_A_VIP_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  VIP_NOT_ATTENDEE_MESSAGE,
} from "#/features/events/registration";
import {
  VIP_SEARCH_LIMIT,
  VIP_SEARCH_MAX_LENGTH,
  VIP_SEARCH_MIN_LENGTH,
  VipSearchInput,
} from "#/features/events/schema";
import {
  addVipRegistration,
  removeVipRegistration,
  searchVipAttendees,
} from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/** How long the typing must pause before the search runs, so each keystroke does not run one. */
const SEARCH_DEBOUNCE_MS = 300;

const NAMED_REFUSALS = new Set([
  VIP_NOT_ATTENDEE_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  NOT_A_VIP_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
]);

/** The server's named refusal, or "" for any other failure, which the caller words generically. */
function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return NAMED_REFUSALS.has(message) || message.startsWith(EVENT_FULL_MESSAGE) ? message : "";
}

/**
 * PTR-111: the VIP registrations of a published event, for its Organiser and its assigned
 * Coordinator. The VIPs are counted apart from the normal registrations (AC4). The server checks
 * the venue places when a VIP is added, and its refusal names the venue capacity (AC3).
 */
export function VipRegistrations({ eventId, vips }: { eventId: number; vips: VipAttendee[] }) {
  const headingId = `vip-registrations-${eventId}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline justify-between gap-4">
        <p id={headingId} className="body-sm font-medium">
          VIP registrations
        </p>
        <p className="body-sm text-muted-foreground">
          {vips.length === 1 ? "1 VIP" : `${vips.length} VIPs`}
        </p>
      </div>

      {vips.length > 0 && (
        <ul className="mt-3 space-y-3">
          {vips.map(vip => (
            <VipRow key={vip.attendeeId} eventId={eventId} vip={vip} />
          ))}
        </ul>
      )}

      <VipSearch eventId={eventId} inputId={`${headingId}-search`} />
    </section>
  );
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; query: string; attendees: VipAttendee[] }
  | { status: "error"; error: string };

/** What the status line says about a search, for sighted users and screen readers alike. */
function searchStatus(search: SearchState): string | null {
  if (search.status === "searching") return "Searching…";
  if (search.status !== "done") return null;
  const found = search.attendees.length;
  if (found === 0) return `No Attendee without a registration matches “${search.query}”.`;
  if (found === VIP_SEARCH_LIMIT) {
    return `${VIP_SEARCH_LIMIT} or more Attendees match. Type more to narrow the search.`;
  }
  return found === 1 ? "1 Attendee matches." : `${found} Attendees match.`;
}

/**
 * AC1: find an Attendee account by part of its name or email, and add it as a VIP. The search
 * runs when the typing pauses, or at once on Enter.
 */
function VipSearch({ eventId, inputId }: { eventId: number; inputId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const input = useRef<HTMLInputElement>(null);
  // Each search takes the next number, and only the latest may show its answer. A slow answer to
  // an older query therefore never replaces the answer to a newer one.
  const latest = useRef(0);
  // The term of the search that ran last, so the paused-typing search does not repeat an Enter.
  const ran = useRef<string | null>(null);

  async function runSearch(term: string) {
    ran.current = term;
    latest.current += 1;
    const mine = latest.current;
    setSearch({ status: "searching" });
    try {
      const attendees = await searchVipAttendees({ data: { id: eventId, query: term } });
      if (mine === latest.current) setSearch({ status: "done", query: term, attendees });
    } catch (error) {
      // The event or the caller's assignment may have changed since the page loaded.
      await router.invalidate();
      const refusal = refusalOf(error);
      if (mine === latest.current) {
        setSearch({
          status: "error",
          error: refusal || "Could not search the Attendees. Try again.",
        });
      }
    }
  }

  const form = useForm({
    defaultValues: { query: "" },
    // Enter searches at once; the schema refuses a query too short to search, in its own words.
    validators: { onSubmit: VipSearchInput.omit({ id: true }) },
    onSubmit: ({ value }) => runSearch(value.query.trim()),
  });

  /** Each keystroke drops any answer still on its way, which is for the query as it was. */
  function typed(value: string) {
    latest.current += 1;
    ran.current = null;
    if (value.trim().length < VIP_SEARCH_MIN_LENGTH) setSearch({ status: "idle" });
  }

  /** After an addition the search starts again, unless the user has typed a new one since. */
  function added(term: string) {
    if (form.getFieldValue("query").trim() === term) {
      form.reset();
      typed("");
    }
    input.current?.focus();
  }

  const hintId = `${inputId}-hint`;

  return (
    <div className="mt-4 space-y-3">
      <search>
        <form
          noValidate
          onSubmit={event => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="query"
            listeners={{
              onChange: ({ value }) => {
                const term = value.trim();
                if (term.length >= VIP_SEARCH_MIN_LENGTH && term !== ran.current) {
                  void runSearch(term);
                }
              },
              onChangeDebounceMs: SEARCH_DEBOUNCE_MS,
            }}
          >
            {field => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={inputId}>Add a VIP</FieldLabel>
                <Input
                  ref={input}
                  id={inputId}
                  type="search"
                  autoComplete="off"
                  placeholder="Name or email"
                  maxLength={VIP_SEARCH_MAX_LENGTH}
                  aria-describedby={hintId}
                  aria-invalid={field.state.meta.errors.length > 0}
                  value={field.state.value}
                  onChange={event => {
                    typed(event.target.value);
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldDescription id={hintId}>
                  Search by {VIP_SEARCH_MIN_LENGTH} or more characters of a name or an email.
                </FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </form>
      </search>

      {/* Mounted throughout, and only visually hidden while empty, so a screen reader announces
          each change to it. */}
      <output className="block body-sm text-muted-foreground empty:sr-only">
        {searchStatus(search)}
      </output>
      {search.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {search.error}
        </p>
      )}
      {search.status === "done" && search.attendees.length > 0 && (
        <ul aria-label="Matching Attendees" className="space-y-3">
          {search.attendees.map(attendee => (
            <CandidateRow
              key={attendee.attendeeId}
              eventId={eventId}
              attendee={attendee}
              onAdded={() => added(search.query)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One search result and its addition as a VIP. A refusal stays beside the Attendee it names. */
function CandidateRow({
  eventId,
  attendee,
  onAdded,
}: {
  eventId: number;
  attendee: VipAttendee;
  onAdded: () => void;
}) {
  const router = useRouter();
  const [state, add, adding] = useMutation(async () => {
    try {
      await addVipRegistration({ data: { id: eventId, attendeeId: attendee.attendeeId } });
    } catch (error) {
      // The places or the Attendee's registration may have changed since the page loaded.
      await router.invalidate();
      throw new Error(refusalOf(error), { cause: error });
    }
    toast.success(`${attendee.name} is registered as a VIP.`);
    await router.invalidate();
    onAdded();
  }, "Could not add the VIP registration. Try again.");

  return (
    <li className="body-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{attendee.name}</p>
          <p className="break-all text-muted-foreground">{attendee.email}</p>
        </div>
        <Button
          size="sm"
          disabled={adding}
          aria-label={`Add ${attendee.name} as a VIP`}
          onClick={() => void add()}
        >
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="mt-1 text-destructive">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * AC6: one VIP registration and its removal. The removal frees a venue place that a normal
 * registration can take at once, so it is confirmed first.
 */
function VipRow({ eventId, vip }: { eventId: number; vip: VipAttendee }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, remove, removing] = useMutation(async () => {
    try {
      await removeVipRegistration({ data: { id: eventId, attendeeId: vip.attendeeId } });
    } catch (error) {
      // The VIP, the event or the caller's assignment may have changed since the page loaded.
      await router.invalidate();
      const refusal = refusalOf(error);
      if (!refusal) throw new Error("", { cause: error });
      // The reload can take this row away, so a named refusal goes in a toast, which outlives it.
      setDialogOpen(false);
      toast.error(refusal);
      return;
    }
    setDialogOpen(false);
    toast.success(`${vip.name} is no longer registered as a VIP.`);
    await router.invalidate();
  }, "Could not remove this VIP registration. Try again.");

  return (
    <li className="body-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{vip.name}</p>
          <p className="break-all text-muted-foreground">{vip.email}</p>
        </div>
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                disabled={removing}
                aria-label={`Remove VIP registration: ${vip.name}`}
              />
            }
          >
            Remove
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove VIP registration</AlertDialogTitle>
              <AlertDialogDescription>
                {vip.name} will no longer hold a place at the venue, and a normal registration can
                take it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel size="sm" disabled={removing}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                size="sm"
                variant="destructive"
                disabled={removing}
                onClick={() => void remove()}
              >
                {removing ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
            {state.status === "error" ? (
              <p role="alert" className="body-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
