import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button, buttonVariants } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#/components/ui/empty";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";
import { PlaceHoldRequestButton } from "#/features/venue-requests/components/hold-time-dialog";
import {
  VENUE_HOLD_DECLINE_REASON_MAX_LENGTH,
  VenueHoldDeclineInput,
  formIssues,
  isLeftHoldQueueMessage,
} from "#/features/venue-requests/schema";
import { declineVenueHold } from "#/features/venue-requests/server-fns";
import type { VenueHoldRequest } from "#/features/venue-requests/server-fns";
import { skipRootFilter } from "#/lib/invalidate";

/** PTR-150 AC5: decline a hold request with the reason that the Coordinator receives. */
function DeclineHoldRequestForm({
  request,
  onCancel,
  onSuccess,
}: {
  request: VenueHoldRequest;
  onCancel: () => void;
  onSuccess: () => Promise<void>;
}) {
  const router = useRouter();
  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) => formIssues(VenueHoldDeclineInput, { id: request.id, ...value }),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await declineVenueHold({ data: { id: request.id, ...value } });
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Could not decline this hold request. Try again.";
        // The reload removes a request that left the queue, and this form with it. Show that
        // refusal as a toast. Keep any other refusal in the form.
        if (isLeftHoldQueueMessage(message)) toast.error(message);
        else formApi.setErrorMap({ onSubmit: { fields: {}, form: message } });
        await router.invalidate({ filter: skipRootFilter }).catch(() => {});
        return;
      }

      toast.success(`Hold request declined for ${request.venueName}.`);
      await onSuccess();
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 border-t border-border pt-4"
      onSubmit={event => {
        event.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={`decline-reason-${request.id}`}>Reason for decline</FieldLabel>
            <Textarea
              id={`decline-reason-${request.id}`}
              value={field.state.value}
              maxLength={VENUE_HOLD_DECLINE_REASON_MAX_LENGTH}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>
      <div className="flex gap-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Declining…" : "Confirm decline"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * PTR-150 AC2: the shared hold-request queue. Every Venue Staff member sees each request with its
 * venue, window and requested time, and places it with an expiry or declines it.
 */
export function VenueHoldRequestsPage({ requests }: { requests: readonly VenueHoldRequest[] }) {
  const router = useRouter();
  const [declining, setDeclining] = useState<string | null>(null);
  const [venueFilter, setVenueFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");

  async function finishDecline() {
    setDeclining(null);
    await router.invalidate({ filter: skipRootFilter });
  }

  const venueNames = useMemo(
    () => [...new Set(requests.map(request => request.venueName))].toSorted(),
    [requests]
  );
  const filtered = requests.filter(
    request =>
      (venueFilter === "" || request.venueName === venueFilter) &&
      (dayFilter === "" || request.startsAt.slice(0, 10) === dayFilter)
  );
  const filtering = venueFilter !== "" || dayFilter !== "";

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Venue operations"
        title="Hold requests"
        description="Coordinators ask to hold a venue before they book it. Place each hold with an expiry, so that no hold reserves a venue indefinitely, or decline it with a reason."
      />

      {requests.length > 0 ? (
        <p className="body-sm text-muted-foreground" aria-live="polite">
          {holdCountCopy(filtered.length, requests.length)}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No hold requests are waiting.</EmptyTitle>
            <EmptyDescription>
              Coordinator requests appear here for placement with an expiry.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/dashboard" className={buttonVariants({ size: "sm" })}>
              Back to dashboard
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field>
                  <FieldLabel htmlFor="hold-venue-filter">Filter by venue</FieldLabel>
                  <Select
                    value={venueFilter === "" ? "__all__" : venueFilter}
                    onValueChange={value =>
                      setVenueFilter(value === "__all__" ? "" : (value ?? ""))
                    }
                  >
                    <SelectTrigger id="hold-venue-filter" className="w-full">
                      <SelectValue>
                        {(value: string | null) =>
                          value === null || value === "__all__" ? "All venues" : value
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All venues</SelectItem>
                      {venueNames.map(name => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="hold-day-filter">Filter by day</FieldLabel>
                  <Input
                    id="hold-day-filter"
                    type="date"
                    value={dayFilter}
                    onChange={event => setDayFilter(event.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!filtering}
                  onClick={() => {
                    setVenueFilter("");
                    setDayFilter("");
                  }}
                >
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          {filtered.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No hold requests match these filters.</EmptyTitle>
                <EmptyDescription>Clear a filter and try again.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="grid gap-3">
              {filtered.map(request => (
                <li key={request.id} aria-labelledby={`hold-request-${request.id}`}>
                  <Card>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="eyebrow text-muted-foreground">Hold request</p>
                            <h2 id={`hold-request-${request.id}`} className="mt-1 display-h3">
                              {request.venueName}
                            </h2>
                            <p className="mt-1 body-sm text-muted-foreground">
                              {formatProposedWindow({
                                start: request.startsAt,
                                end: request.endsAt,
                              })}
                            </p>
                            <p className="mt-1 body-sm text-muted-foreground">
                              Requested {formatLocalDateTime(request.requestedAt)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <PlaceHoldRequestButton holdId={request.id} />
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => setDeclining(request.id)}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>

                        {declining === request.id ? (
                          <DeclineHoldRequestForm
                            request={request}
                            onCancel={() => setDeclining(null)}
                            onSuccess={finishDecline}
                          />
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}

function holdCountCopy(filtered: number, total: number) {
  if (filtered !== total) return `Showing ${filtered} of ${total} hold requests`;
  return total === 1 ? "1 hold request waiting" : `${total} hold requests waiting`;
}
