---
date: 2026-10-03
adr-number: ADR-6
status: accepted
---

# ADR-6: Deliver notification emails from a transactional queue drained by a scheduled worker

## Context

Until PTR-55, every feature that raised a notification emailed its recipients inline. It sent the mail after the state change committed. Sends were best-effort. The application logged a failure and ignored it, because the row was already committed. The application loses notices while the mail provider is down. No notification record exists that a user can read in the application.

PTR-55 asks for both. It asks for a notification surface in the application and for email that survives a provider outage. A mail failure must not fail a committed change.

## Decision

One `notifications` table is both the record in the application and the email queue.

- **Raise inside the change's transaction.** Handlers insert one row per recipient in their existing transaction (`raiseNotifications` in `src/features/notifications/raise.server.ts`). A rolled-back change raises nothing. A committed change always has its rows. A row stores the recipient, the event request, the `kind`, and a domain-fact payload. It never stores React props.
- **Render at send time.** `render.server.ts` maps `kind` to the React Email template and builds absolute URLs from `BETTER_AUTH_URL`. The subject is the same `notificationSummary` line that the inbox shows. A template change therefore reaches every pending row.
- **Deliver from a worker.** `POST /api/cron/notifications` claims up to 50 pending rows. It uses one `UPDATE` over a `FOR UPDATE SKIP LOCKED` subquery. It holds a ten-minute lease (`claimed_at`) and honors `next_attempt_at`. The worker sends outside the transaction. Success sets `emailed_at`. Failure backs off (1, 2, 4, … capped at 30 minutes) or dead-letters at `failed_at` after ten attempts. It stores only the error's name. The notification id is the provider's idempotency key.
- **Schedule it with Cloud Scheduler.** One scheduler job per environment posts to that environment's Cloud Run URI every minute. The route requires a `CRON_TOKEN` bearer. It compares the bearer in constant time. It fails closed when the token is unset. The job is Terraform-owned. It uses a placeholder header and `ignore_changes`, because the token must never enter state. An operator installs the real header once per environment with `gcloud scheduler jobs update http`.
- **Account mail stays synchronous.** `src/lib/auth.server.ts` sends sign-up verification and password reset inline. They sit on the critical path of registration and sign-in. There, a queue delay is a worse failure than a slow request.

## Alternatives Considered

### Keep inline sends and add retries

- Pros: no table, no worker, no scheduler.
- Cons: retry state lives in a request that already returned. A restart loses it. There is still no record in the application.
- Rejected: cannot promise delivery across a provider outage.

### Store the rendered email HTML in the queue

- Pros: the worker becomes trivial.
- Cons: template changes never reach pending rows. The queue couples to the presentation layer.
- Rejected: rendering at send time keeps one source for subject, inbox line and email.

### A Cloud Run Job or a Cloudflare Worker cron

- Pros: no public route, or a scheduler with a second platform's tooling.
- Cons: a job needs a second entrypoint and image path. Cloudflare adds a second platform and a database route, against [ADR-3](./ADR-3-cloud-run.md).
- Rejected: one HTTP route on the existing service is the smallest operational surface.

### Deliver when the user opens the inbox

- Pros: no scheduler.
- Cons: users who never sign in receive no mail. That breaks the purpose of the notification.
- Rejected.

## Consequences

- Delivery is at-least-once. A crash between send and mark re-sends. The provider idempotency key dedupes where supported. The provider keeps that key for 24 hours and replays it only while the payload is identical. A template or `BETTER_AUTH_URL` change between attempts makes the provider answer 409. The row then spends its attempts and dead-letters, even though the first send went out. The SMTP capture that E2E uses ignores it. Duplicate sends are the accepted risk. The worker does not hold a transaction open across an HTTP call.
- The worker route is public but bearer-guarded. `CRON_TOKEN` is optional in `src/env.ts`. An unset token answers 401.
- A minute-cadence job against a scale-to-zero service pays a cold start per tick. Change the interval with a one-line scheduler change if that cost exceeds notification latency.
- `notifications` rows are the only inbox source. The read side re-applies the PTR-8 relationship rule. It neutralizes rows whose subject the caller can no longer reach. The application does not re-expose an email already sent after access ends. Delivery does not re-check reachability. A queued row is a notice raised while the recipient was connected. The email can arrive after that connection ends. The inbox read is the surface that applies current access.
  Reachability reflects the caller's current event relationship. It does not reflect the notification subject. Once a request is decided, a Venue Staff member who did not decide it sees the row neutralized. A raiser whose event has since been reassigned also sees the row neutralized. This holds even though the notice was addressed to them. This upholds the deliberate AC5 reading: an unreachable event yields no data.
- To add a notification kind, add a new enum value, a payload schema, a summary, an href, and a template arm. `tests/unit/db-schema.test.ts` keeps the PostgreSQL enum and the client list identical.
