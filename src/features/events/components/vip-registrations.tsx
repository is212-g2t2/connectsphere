import { useEffect, useRef, useState } from "react";
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
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field";
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
  VIP_SEARCH_MAX_LENGTH,
  VIP_SEARCH_MESSAGE,
  VIP_SEARCH_MIN_LENGTH,
} from "#/features/events/schema";
import {
  addVipRegistration,
  removeVipRegistration,
  searchVipAttendees,
} from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/** How long the typing must pause before the search runs, so each keystroke does not run one. */
const SEARCH_DEBOUNCE_MS = 300;

export const NAMED_REFUSALS = new Set([
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

/**
 * AC1: find an Attendee account by part of its name or email, and add it as a VIP. The search
 * runs when the typing pauses, or at once on Enter.
 */
function VipSearch({ eventId, inputId }: { eventId: number; inputId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Each search takes the next number, and only the latest may show its answer. A slow answer to
  // an older query therefore never replaces the answer to a newer one.
  const latest = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function runSearch(term: string) {
    latest.current += 1;
    const mine = latest.current;
    setSearch({ status: "searching" });
    try {
      const attendees = await searchVipAttendees({ data: { id: eventId, query: term } });
      if (mine === latest.current) setSearch({ status: "done", query: term, attendees });
    } catch (error) {
      if (mine === latest.current) {
        setSearch({
          status: "error",
          error: refusalOf(error) || "Could not search the Attendees. Try again.",
        });
      }
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    // An answer still on its way is for the old query.
    latest.current += 1;
    const term = value.trim();
    if (term.length < VIP_SEARCH_MIN_LENGTH) {
      setSearch({ status: "idle" });
      return;
    }
    timer.current = setTimeout(() => void runSearch(term), SEARCH_DEBOUNCE_MS);
  }

  const [added, add, adding] = useMutation(async (attendee: VipAttendee) => {
    try {
      await addVipRegistration({ data: { id: eventId, attendeeId: attendee.attendeeId } });
    } catch (error) {
      // The places or the Attendee's registration may have changed since the page loaded.
      await router.invalidate();
      throw new Error(refusalOf(error), { cause: error });
    }
    toast.success(`${attendee.name} is registered as a VIP.`);
    changeQuery("");
    await router.invalidate();
  }, "Could not add the VIP registration. Try again.");

  const hintId = `${inputId}-hint`;

  return (
    <div className="mt-4 space-y-3">
      <search>
        <form
          noValidate
          onSubmit={event => {
            event.preventDefault();
            clearTimeout(timer.current);
            const term = query.trim();
            if (term.length >= VIP_SEARCH_MIN_LENGTH) void runSearch(term);
          }}
        >
          <Field>
            <FieldLabel htmlFor={inputId}>Add a VIP</FieldLabel>
            <Input
              id={inputId}
              type="search"
              autoComplete="off"
              placeholder="Name or email"
              maxLength={VIP_SEARCH_MAX_LENGTH}
              aria-describedby={hintId}
              value={query}
              onChange={event => changeQuery(event.target.value)}
            />
            <FieldDescription id={hintId}>{VIP_SEARCH_MESSAGE}.</FieldDescription>
          </Field>
        </form>
      </search>

      {search.status === "searching" && (
        <output className="block body-sm text-muted-foreground">Searching…</output>
      )}
      {search.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {search.error}
        </p>
      )}
      {search.status === "done" &&
        (search.attendees.length === 0 ? (
          <output className="block body-sm text-muted-foreground">
            No Attendee without a registration matches “{search.query}”.
          </output>
        ) : (
          <ul aria-label="Matching Attendees" className="space-y-3">
            {search.attendees.map(attendee => (
              <li
                key={attendee.attendeeId}
                className="flex items-start justify-between gap-4 body-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{attendee.name}</p>
                  <p className="break-all text-muted-foreground">{attendee.email}</p>
                </div>
                <Button
                  size="sm"
                  disabled={adding}
                  aria-label={`Add ${attendee.name} as a VIP`}
                  onClick={() => void add(attendee)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {added.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {added.error}
        </p>
      )}
    </div>
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
      // Someone else may have removed it since this page loaded.
      await router.invalidate();
      throw new Error(refusalOf(error), { cause: error });
    }
    setDialogOpen(false);
    toast.success(`${vip.name} is no longer registered as a VIP.`);
    await router.invalidate();
  }, "Could not remove this VIP registration. Try again.");

  const refusal =
    state.status === "error" ? (
      <p role={dialogOpen ? "alert" : undefined} className="body-sm text-destructive">
        {state.error}
      </p>
    ) : null;

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
            {/* One copy at a time: two live role="alert" nodes would announce twice. */}
            {dialogOpen && refusal}
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {!dialogOpen && refusal}
    </li>
  );
}
