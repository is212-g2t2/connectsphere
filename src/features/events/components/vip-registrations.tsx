import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { PlusIcon, Trash2Icon } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
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

/** Time in ms to wait after typing stops before the search runs. */
const SEARCH_DEBOUNCE_MS = 300;

const NAMED_REFUSALS = new Set([
  VIP_NOT_ATTENDEE_MESSAGE,
  VIP_ALREADY_REGISTERED_MESSAGE,
  NOT_A_VIP_MESSAGE,
  VIPS_CLOSED_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
]);

/** Return the server's named refusal. Return "" for any other failure. The caller words those generically. */
function refusalOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return NAMED_REFUSALS.has(message) || message.startsWith(EVENT_FULL_MESSAGE) ? message : "";
}

/**
 * PTR-111: Add a VIP registration to a published event with this dialog. Its Organiser and
 * assigned Coordinator use it. The registrations section renders it beside the attendee table's
 * filters. Count VIPs apart from normal registrations (AC4). The server checks the venue places
 * on add. Its refusal names the venue capacity (AC3).
 */
export function AddVipDialog({ eventId }: { eventId: number }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button size="sm" aria-label="Add VIP">
            <PlusIcon />
            Add VIP
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a VIP</DialogTitle>
          <DialogDescription>Search for an Attendee account to add as a VIP.</DialogDescription>
        </DialogHeader>
        <VipSearch eventId={eventId} inputId={`vip-add-${eventId}-search`} />
      </DialogContent>
    </Dialog>
  );
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "done"; query: string; attendees: VipAttendee[] }
  | { status: "error"; error: string };

/** Status-line text for a search, for sighted users and screen readers alike. */
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
 * AC1: Find an Attendee account by part of its name or email, and add it as a VIP. The search
 * runs when typing pauses, or at once on Enter.
 */
function VipSearch({ eventId, inputId }: { eventId: number; inputId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const input = useRef<HTMLInputElement>(null);
  // Number each search. Only the latest shows its answer. A slow answer to an older query never
  // replaces a newer answer.
  const latest = useRef(0);
  // The term of the last search run. The paused-typing search does not repeat it.
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
    // Enter searches at once. The schema refuses a too-short query in its own words.
    validators: { onSubmit: VipSearchInput.omit({ id: true }) },
    onSubmit: ({ value }) => runSearch(value.query.trim()),
  });

  /** Each keystroke drops any answer still on its way. That answer belongs to the old query. */
  function typed(value: string) {
    latest.current += 1;
    ran.current = null;
    if (value.trim().length < VIP_SEARCH_MIN_LENGTH) setSearch({ status: "idle" });
  }

  /** After an addition the search starts again, unless the user typed a new query since. */
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
                <FieldLabel htmlFor={inputId}>Search attendees</FieldLabel>
                <Input
                  ref={input}
                  id={inputId}
                  type="search"
                  autoComplete="off"
                  placeholder="Search by name or email"
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

      {/* Keep this mounted throughout. Hide it visually while empty. A screen reader then announces
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

/** Show one search result with its add-as-VIP action. Keep a refusal beside the Attendee it names. */
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
 * AC6: Remove one VIP registration. The removal frees a venue place for a normal registration.
 * Confirm it first. The registrations section renders it as a VIP row action.
 */
export function RemoveVipButton({ eventId, vip }: { eventId: number; vip: VipAttendee }) {
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
      // The reload can take this row away. Show a named refusal in a toast. The toast outlives
      // the row.
      setDialogOpen(false);
      toast.error(refusal);
      return;
    }
    setDialogOpen(false);
    toast.success(`${vip.name} is no longer registered as a VIP.`);
    await router.invalidate();
  }, "Could not remove this VIP registration. Try again.");

  return (
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <AlertDialogTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            disabled={removing}
            aria-label={`Remove VIP registration: ${vip.name}`}
          >
            <Trash2Icon />
          </Button>
        }
      />
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove VIP registration</AlertDialogTitle>
          <AlertDialogDescription>
            {vip.name} will no longer hold a place at the venue, and a normal registration can take
            it.
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
  );
}
