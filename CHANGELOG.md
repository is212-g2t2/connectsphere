# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-04

### Added

- **Coordinator handover**: a Coordinator offers an assigned event to a named colleague, who accepts or declines it from `/coordination`. The outgoing Coordinator keeps the event and its access until the colleague accepts. Acceptance moves the assignment and records it in assignment history. The offer emails the colleague, an acceptance emails the Organiser, and a decline emails the outgoing Coordinator.
- **Booking release and amendment**: Venue Staff see upcoming approved bookings at `/venue-bookings`. The staff member who approved a booking releases it with a required reason, or amends its venue or period. A release records a `released` status and frees the period, and the assigned Coordinator gets an email for each release or amendment.
- **Tentative venue holds**: a Coordinator places a hold on a venue and period, then releases it or converts it into a booking request. A Postgres exclusion constraint refuses overlapping holds. Holds show on the availability calendar and venue search. The Venue Staff queue flags a request that overlaps a hold, and the system refuses its approval.
- **Adjusted booking requests**: the rejection card offers "Adjust request", which opens the suggested venue, or the refused one, with the request form prefilled from the suggestion. The rejection stays on the card next to the new pending request until Venue Staff decide it.
- **Event equipment lines**: the assigned Coordinator adds, edits, and removes the equipment an approved or planning event needs, and submits the list to Technical Support Staff, who get an email.
- **Equipment request review**: Technical Support Staff get a work list at `/equipment-requests` and a detail page for each event. They set each line to requested, not required, or unavailable (with a required reason), and add notes. The assigned Coordinator sees each line's state and notes, and gets an email when a line becomes unavailable. The Organiser sees the state without the notes or reason.
- **Equipment availability and reservation**: Technical Support Staff check the free units of a catalogue equipment type for the event's approved booking period, and the check names any shortfall. They reserve units for that period, and a lock on the equipment type keeps the combined reservations within capacity.
- **Reservation reduction and release**: Technical Support Staff return some or all of a line's reserved units, which frees them for every overlapping event. A full release can carry a reason that marks the line unavailable. The line records who released the units and when, and the Coordinator gets a notification.
- **Completed technical arrangements**: Technical Support Staff mark an event's equipment arrangements as settled, and the assigned Coordinator gets a notification. A change to the arrangements clears the mark, and confirmation freezes them.
- **Event confirmation**: the assigned Coordinator confirms an approved or planning event when it has one approved venue booking and, if it has equipment lines, settled technical arrangements. A refusal names each outstanding item. The Organiser gets an email and sees the confirmed arrangements.
- **Notification inbox**: `/notifications` lists the caller's notifications, newest first, with an unread count, and the header links to it for every signed-in user. A user marks one notification read, or all of them. A notification whose event the user can no longer reach shows no event data.
- **Queued notification email**: every notification email goes into a transactional queue that commits with the change that raises it. Cloud Scheduler calls `/api/cron/notifications` every minute with the new `CRON_TOKEN`. The worker retries a failed email with backoff and moves it to a dead-letter state after ten attempts. Authentication emails skip the queue and still send at once.

### Changed

- **Notification email delivery**: decision, clarification, and venue booking emails go through the notification queue instead of a best-effort send after commit. A failed send now retries, and an email goes out on the next one-minute run.
- **Coordinator reassignment**: a Coordinator moves an assigned event to a colleague only through an accepted handover. The assign function takes unassigned events only, and its refusal of an assigned event names the handover.
- **Dependencies**: most direct dependencies move to newer versions, the Sentry SDK among them from v10 to v11, and both Sentry initialization sites use the v11 `dataCollection` baseline. The dependency audit ignores the unpatched `braces` advisory GHSA-vfj7-8cjw-p6xm until a fix ships.
- **Documentation**: the technical documentation follows ASD-STE100 Simplified Technical English, and `ARCHITECTURE.md` adds system context, deployment, and entity relationship diagrams.

### Removed

- The presigned upload demo: `POST /api/upload-url`, its storage helper, dashboard card, and permission.
- MinIO in Compose and CI, and the Cloudflare R2 buckets in Terraform.
- The `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY` environment variables.
- 49 unused UI component files, including the data-table folder, and 8 unused dependencies, among them `recharts`, `cmdk`, `@tanstack/react-table`, and `aws4fetch`.

## [0.2.0] - 2026-09-28

### Added

- **Event review queue**: Coordinators take up a submitted request from its coordination page, and it stays on the internal dashboards while attendees who already registered keep their view of the event. Take-up is one guarded update that answers 403 or 409 without a partial change.
- **Event status set**: `planning`, `confirmed`, `completed`, and `cancelled` join the status enum. One client-safe label map and the `EventRequestStatusBadge` pill cover every list and detail page, and each status carries whether a decision stands on it and how that decision went.
- **Recorded decisions**: a Coordinator approves, or rejects with a required reason, and the row records who decided and when. The Organiser is emailed after the decision commits, a failed send is logged without undoing the decision, and the outcome is durable in the request views.
- **Clarification requests and replies**: a Coordinator asks the Organiser for clarification or an amendment, and the Organiser answers from the request detail page. Both emails send after commit, a failed send is logged without recipient data, and a reply records the request it answers.
- **Venue search from an event**: a Coordinator opens search prefilled from any event they still work in, composes requirement filters, and sees live availability. A search returns the venues that meet every requirement.
- **Named unsuitability**: a venue that falls short stays on the page under "Not suitable", with each failing criterion named in a sentence (capacity, location, layout, accessibility, facilities, availability, or an approved booking). Search and suitability read one function, so a venue cannot pass the filter yet fail a rule.
- **Venue booking requests**: a Coordinator raises a request for a venue and period and can withdraw it. Venue Staff get a shared queue of unassigned pending requests with a detail page that reads the event's live requirements, and a notification.
- **Booking decisions**: Venue Staff approve a request after a confirmation naming the venue and window, or reject it with a required reason and an optional alternative venue and period. Both paths hold the same row lock and queue rule, so a race settles the request once, and the Coordinator who raised it is emailed either way. A rejection stays on the assigned Coordinator's event card until a newer request supersedes it.
- **No double-booking**: a Postgres exclusion constraint refuses an approval that overlaps a booking already approved for the venue, with a refusal that reads as a wall-clock period. Approved bookings feed the venue search, the availability calendar, and a "Conflicting booking" flag on the queue, while pending requests stack and touching periods stay free.

### Changed

- **Form handling**: the calendar, decision, clarification, and search forms run on TanStack Form with one Standard Schema validation path. Submitting the Coordinator assignment form empty shows the field error instead of failing silently.
- **Server errors**: the shared session middleware sets the wire status with `setResponseStatus`, and server functions throw typed errors, so callers and SSR reject naturally; the `unwrapRefusal` helper is gone from every loader and component.

## [0.1.0] - 2026-09-20

### Added

- **External registration**: visitors sign up as Event Organiser or Attendee with their name and password, and internal roles cannot be claimed at sign-up. The password policy is enforced server-side on sign-up, reset, and change, and a refused password names the rule it broke.
- **Role and function matrix**: five roles (`attendee`, `event_organiser`, `event_coordinator`, `venue_staff`, `technical_support_staff`) declared once in `src/features/auth/permissions.ts` and enforced on every server function, `POST /api/upload-url`, and the interface. A `role` change through `/update-user` is refused, so nobody can promote their own account.
- **Role-aware sign-in**: every role lands on `/dashboard`, which varies its contents by permission instead of separate landing pages. A failed sign-in returns one generic message that does not reveal whether the email exists.
- **Seed data**: `bun run db:seed` creates one account for each internal role with a working credential, plus three demo venues with their full details and two periods of unavailability. Re-runnable without duplicating records.
- **Draft event requests**: an Event Organiser starts a request at `/event-requests` and saves it incomplete. A draft belongs only to its creator, carries no Coordinator, allows blank fields, and refuses malformed values such as an end before its start, a non-positive attendance, or over-long text.
- **Full event requirements**: name, purpose, one or more proposed date/time windows, and expected attendance are required. Description, event type, venue requirements, room layout, accessibility requirements, special arrangements, and repeatable equipment lines are optional, and every value round-trips exactly as entered.
- **Attendee registration terms**: registration starts off. Turning it on requires capacity, opening, and closing times together; window order and a positive whole-number capacity are enforced in Zod and by database CHECKs, and turning registration off clears any stored terms.
- **Draft resumption and deletion**: Resume reopens a draft in the form, and saving there updates that row. Delete confirms inline, answers a submitted request with 409, and treats another organiser's or unknown id as not found.
- **Event request submission**: a saved draft submits in one transaction, refused with every missing item listed until it is complete. A submitted request records its time, shows a confirmation, and refuses direct edits.
- **Organiser request list**: `/event-requests` lists the organiser's requests, drafts included, newest change first, with a status pill and the assigned Coordinator. The detail view is read-only, and another organiser's id answers not found.
- **Automatic Coordinator assignment**: submission assigns the Event Coordinator with the fewest submitted requests (earliest account on a tie) inside the same transaction. With no Coordinator available, the request is still recorded and waits at `/coordination`.
- **Coordinator handover and pickup**: `/coordination` lists assigned and unassigned requests. A Coordinator assigns an unassigned request to themselves or a named Coordinator, or hands over their own. Ownership is re-checked on every read and write, competing assignments are serialised by a row lock, and each change is recorded in assignment history. Notifications are not sent yet.
- **Relationship-scoped event access**: the dashboard's `listEvents` server function returns only the events a user is connected to: as organiser, assigned Coordinator, venue or technical staff the request is directed to, or attendee with an open registration window or their own registration. Each access gets a role-specific projection, and an unrelated or unknown event named by id is refused with a generic 403 that carries no event data.
- **Venue catalogue**: Venue Staff create and edit each venue's name, location, maximum capacity, facilities, accessibility features, supported room layouts, and per-day operating hours under `/venues`. Coordinators and Technical Support Staff get read-only access; organisers and attendees are refused.
- **Venue availability calendar**: `/venues/availability` shows a venue's free, confirmed, and blocked periods over an inclusive date range, with a month calendar marking the occupied days and a list naming each block. Recorded unavailability is read live, while confirmed bookings await booking persistence.
- **ConnectSphere design system**: the TanStack starter's demo is replaced with the product's palette, Inter, pill actions, and one shared focus ring. Every page and primitive conforms behind a shadcn lint gate, and status colours clear WCAG AA in both themes.
- **Observability**: server functions log business events for request submission, Coordinator assignment, and venue writes through per-feature child loggers, with recipient addresses masked and upstream error payloads bounded.
- **Cloud Run deployment**: staging and production run in one GCP project as `connectsphere-staging.ciav.dev` (from `staging`) and `connectsphere.ciav.dev` (from `main`), with Terraform-owned services, Supabase Postgres, Cloudflare R2 uploads, and Secret Manager configuration. Every release stages the new revision at 0% traffic, migrates the database, smoke-tests the staged revision through a Bearer-guarded `/api/smoke`, and only then promotes it.
- **Release automation**: pushes to `main` deploy staging; production deploys from a published release. release-please maintains the version pull request and tags `v*` releases, and the pipeline reuses the image digest staging built.

### Changed

- **Authorization middleware**: every `createServerFn` runs behind `withSession`/`requireSession`/`requirePermission`, which answer 401 or 403 before any handler or database work. The per-feature boundary wrappers are gone.
- **Client mutations**: browser writes run through one managed action lifecycle rather than hand-rolled `useState` flags. A mutation-triggering button, sign-out and account deletion included, is disabled for exactly as long as its run is open, a rejection returns the interface to an interactive state, and a server-assigned draft id reaches the next save, so a second save edits the same row.
- **Application structure**: the session resolves once in the root route, and the `_authenticated` layout guards its children. Route modules are wiring only, with page views in their feature's `components/`; server-only modules carry the `.server.ts` suffix; and route loaders and server functions replace TanStack Query.
- **Bundle and image weight**: unused UI dependencies are dropped, Sentry replay loads lazily from its CDN, devtools are development-only, and the Docker image ships traced server dependencies instead of a `node_modules` copy, cutting the local image to 141.2 MB.
- **Test and CI infrastructure**: integration and E2E databases are provisioned from committed migrations, E2E runs against a production server it starts and captures email through a local SMTP relay, and CI gates every non-draft pull request on a production build.
- **Client-bundle safety guard**: now scans every module under `src/features`, `src/hooks`, `src/lib`, and `src/components`, not only modules exporting server functions.

### Fixed

- Missing popover theme tokens left every dropdown surface transparent.
- The settings page stuck on "Loading…" for linked providers instead of showing the empty state.
- A refusal returned through a pending call could resolve as account data and crash the settings view.
- Toast status colours did not render until the Sonner palette mapping was restored.

### Removed

- Email OTP sign-in, its `/verify-otp` route and component, and its email template.
- Passkey support, the `passkey` table, and the `@better-auth/passkey` dependency.
- Google OAuth and the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables.
- TanStack starter leftovers: the notes demo, both Sentry example routes, the unused sidebar primitive and its hook, and the unused `radix-ui`, `vaul`, and `@tailwindcss/typography` dependencies.
