# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-10-25

### Added

- **Event Coordinator Lead**: a new role watches the queue of unassigned requests and reads every event. A submission no longer assigns a Coordinator by itself, and every Lead gets a notice for it and for each change or cancellation request on an unassigned event. The queue flags those requests, the Organiser gets a receipt, and the seed adds a second Coordinator, two Leads, and a Safety Officer.
- **Lead assignment and oversight**: the Lead assigns an unassigned request, or reassigns an assigned one, and the move takes effect at once with the Lead and the time on record. The incoming Coordinator and the Organiser get a notice, and a reassignment also notifies the outgoing Coordinator. The Lead sees every Coordinator ranked by active load, with active and closed events, and opens an event read-only apart from reassignment.
- **Safety review**: a new Safety Officer role works a review list at `/safety-reviews` and approves, rejects, or requests changes on an event's operational safety, with comments required for a rejection or change request. A decision other than approval returns the event to planning and notifies the assigned Coordinator, or every Lead when none is assigned. A stored fingerprint of the event's arrangements ties each decision to what the Officer saw, and the server refuses a stale or repeated decision.
- **Automatic safety review**: the one-minute cron queues a review when an event's venue and equipment arrangements are complete, and every Safety Officer gets a notice. A change to the arrangements refreshes a pending review, and the list shows "Updated" or "Withdrawn: arrangements changed". A future confirmed event whose review no longer approves returns to planning, and the Coordinator gets a notice.
- **Safety review restart**: after a rejection or change request, the assigned Coordinator starts a fresh review once the arrangements are complete. The restart notifies every Safety Officer and names each refusal, among them an event that has already started. The event pages show the safety stage in place of the plain status until confirmation.
- **Hold requests**: a Coordinator requests a tentative hold, and the request holds no venue time. Venue Staff work a shared queue at `/venue-holds`: they place a request with an expiry, which checks the event and the venue again and writes the ledger row with the venue's current buffers, or decline it with a reason. The Coordinator withdraws a request before placement and gets a notice of each result.
- **Hold expiry**: the cron frees a hold at its expiry and notifies the assigned Coordinator once at the warning point and once at expiry. The sweep keeps each notice to one per hold.
- **Replacement chains**: a new venue request names the rejected, released, or about-to-be-released request that it replaces, and the adjust link fills this in. Confirmation counts a settled request as answered only through its replacement chain, and the assigned Coordinator dismisses one that is no longer needed. A partial unique index keeps one live replacement for each request.
- **Registration cap by venue capacity**: the registration ceiling is the total capacity of the distinct approved venues that no live block suspends. Refusals, the VIP ceiling, and withdrawals name this total. The confirmation and registration notices list each approved venue and window.
- **Waiting list**: an Attendee joins the waiting list of a full event with an open registration window and leaves it at will. Every waitlisted Attendee gets one notice each time the event goes from full to not full, and places stay first come, first served. The list clears when registration closes, and a cancellation notifies it first. The Organiser and the Coordinator see the list in join order, and the Attendee sees the status on the event page and the dashboard.
- **Draft supporting documents**: an Organiser attaches floor plans and programmes to a draft (PDF, PNG, JPEG, or DOCX, up to 10 files of 10 MB each) and removes one from the draft page. Deleting a draft removes its stored files after the deletion commits. Files go to a private S3 bucket, Cloudflare R2 when deployed and SeaweedFS from Compose locally ([ADR-8](docs/adrs/ADR-8-draft-attachments-storage.md)), set with the new `STORAGE_*` variables.
- **Event documents**: the event page lists the attachments for the owning Organiser, the assigned Coordinator, a Lead, and a reviewing Safety Officer. Each file downloads through a route that checks the session. Any other caller gets the same response as for a missing file.
- **Request reuse**: an Organiser copies a completed or past request into a new draft from the request list. The copy keeps the name, purpose, description, attendance, venue and accessibility needs, layout, and equipment lines. It resets the dates, the registration terms, and every decided or arranged value.

### Changed

- **Equipment reservations**: each equipment line serves one approved venue booking, and Technical Support picks the booking when an event has several. The availability check and the reservation use that booking's window with its setup and turnaround time. Staff views show "Window changed" when the booking's window moves or the booking is released.
- **Availability and search**: the calendar, venue search, and booking queue read bookings, holds, and blocks from the occupancy ledger with their stored buffers, so they refuse the same windows that approval refuses. The queue splits its unavailable flag into "Venue blocked" and "Outside operating hours".
- **Coordinator handover**: the Lead's assignment replaces the handover. A Coordinator no longer picks up or transfers a request. The handover actions and readers go, and the old handover rows stay readable as history.
- **Event confirmation**: confirmation needs a current, approved safety review. The refusal names a missing, pending, rejected, changes-requested, or out-of-date review, and an event that has already started skips the gate.
- **Submission requirements**: submission now needs the description, venue requirements, room layout, and accessibility needs, and the refusal names each missing field. Draft saves stay permissive, and registration stays optional.
- **Event request form**: the form groups its fields into event details, requirements, registration, and equipment. Event type and room layout are selects, and venue and accessibility requirements are checkbox groups with an exclusive "None" choice and an "Other" value.
- **Deployment**: the deployed smoke check uploads and deletes a test object in the attachment bucket, so a release fails while storage is missing or wrong. Terraform takes a new `r2_account_id` variable and two new storage secrets, and the operator creates the private R2 buckets by hand ([`infra/README.md`](infra/README.md)).
- **Dependencies**: 22 dependencies move to newer minor and patch versions, among them the Sentry SDK 11.6.0 to 11.8.0, `@tanstack/react-start` 1.168.61 to 1.169.2, and `better-auth` 1.7.7 to 1.7.10. `bun audit fix` moves `body-parser`, `fast-uri`, `nodemailer`, `undici`, and `ip-address` to patched versions, and `shadcn` 4.22.1 removes the last zod 3 advisory from the tree.

### Removed

- The Coordinator's pick-up of unassigned requests, and the handover offer, accept, and decline actions with their readers. The retired `event_handovers` rows stay in the database as history.

## [0.5.0] - 2026-10-19

### Added

- **Venue setup and turnaround times**: Venue Staff set the minutes of setup before, and turnaround after, a booking or hold at a venue. Each value is a whole number from 0, and each save records who changed it and when.
- **Venue occupancy ledger**: every approved booking, held hold, and live block has one row in `venue_occupancy`. One Postgres exclusion constraint, `venue_occupancy_no_overlap`, refuses overlapping rows and counts setup and turnaround time on both sides. Bookings and holds now exclude each other in the database, and a refusal names the venue and the occupied period ([ADR-7](docs/adrs/ADR-7-venue-occupancy-ledger.md)).
- **Several venues for one event**: the Coordinator requests and manages bookings at more than one venue for one event, including several windows at one venue. Each request carries its session's expected attendance, layout, accessibility, and facilities, which start from the event's values. Suitability, availability, and overlap with the event's other sessions are checked for each venue on its own.
- **Venue blocks**: Venue Staff record a block with a reason and an optional end from the venue calendar, and lift it later. A block suspends the bookings and holds that it covers, refuses new bookings, holds, and overlapping blocks, and notifies the affected Coordinators. A lift restores the suspended rows and keeps the block as history.
- **Re-planning after a block**: a block over a confirmed event's booking returns the event to planning, and the Coordinator sees each suspended booking and hold with the block's reason. The Coordinator releases a suspended booking in favour of a replacement, and the Venue Staff member who settled it gets a notice. When the event is confirmed again, the Organiser and each registered Attendee get a notice that names the new arrangements.
- **Hold expiry**: Venue Staff set, extend, or shorten the expiry of a tentative hold. The assigned Coordinator sets or clears its warning time, which must come before the expiry. An expiry save records who made it and when and notifies the Coordinator, and the calendar shows both times.
- **Buffer change conflicts**: a change to a venue's setup or turnaround time flags the commitments that now overlap, on the venue page and the calendar, and notifies the assigned Coordinators. Nothing releases automatically, and stored bookings and holds keep the buffers that they used when written.
- **Clearing a settled venue request**: the Coordinator who raised a rejected or released venue request, or the event's assigned Coordinator, withdraws it so it stops blocking confirmation. The page shows the reason and the effect on confirmation, and says when a later request has already answered the row.

### Changed

- **Event confirmation**: confirmation needs every venue request on the event to be approved, withdrawn, or answered by a later request. The refusal names each pending, rejected, or released booking, in a stable order.
- **Venue conflict checks**: approval and amendment check availability first and the ledger second. They name a block, then a booking, then a hold, and the conflict flag in the queue uses the same order. The Postgres constraints `venue_requests_no_overlap` and `venue_holds_no_overlap` give way to the ledger constraint (migration 0048).
- **Seed**: the seed records its periods of unavailability as blocks with ledger rows, and a re-run lifts only its own blocks before it records them again.

## [0.4.0] - 2026-10-11

### Added

- **Attendee event discovery**: an Attendee opens the page of a confirmed event with registration on and sees a published view with no internal planning fields. A loading shape covers the page while it loads.
- **Event registration**: an Attendee registers for a confirmed event inside its registration period. The registration refuses a full event, a full venue that names its capacity, and a second registration, and the last place goes to one Attendee. The Attendee sees "N / M registered", and the Organiser and the assigned Coordinator get a notice at 90% and at the place limit.
- **Registration state**: the event page offers Register exactly when a registration succeeds. It shows the opening time before the period opens and says when the period has closed or the event is full, and it counts VIPs against the venue. A cancelled event keeps its page for a registered Attendee and says it is cancelled.
- **My registrations**: the dashboard shows the signed-in Attendee their registration on each event card, with the event's name, date, time, venue, and status and the registration's state.
- **Withdrawal and re-registration**: an Attendee withdraws a registration and registers again later. A withdrawal that frees a place in a full event sends a freed-place notice.
- **Registration boundary notices**: the Organiser and the assigned Coordinator get a notice when registration opens and when it closes for a confirmed event.
- **Registration list for organisers and coordinators**: the Organiser and the assigned Coordinator see the active registrations with the count against capacity, and the list marks VIPs apart and counts them. The Registrations section carries a searchable, sortable, filterable table.
- **VIP registration**: the Organiser or the assigned Coordinator finds an Attendee by name or email, adds them as a VIP, and removes them after a confirmation. A VIP skips the registration capacity and period, with the venue on the approved booking as the only capacity limit, and VIPs count against the venue for normal registration. The record shows who added or removed each VIP and when.
- **Change requests**: the Organiser requests changes to a submitted event from the event request page. The assigned Coordinator applies a waiting request by saving the event information with the request attached, or declines it with a required reason, and tells the Organiser either way. The Organiser and the Coordinator see each request and its outcome on the record, and the coordination list counts the waiting requests on each event.
- **Event information update**: the assigned Coordinator edits an approved, planning, or confirmed event from the coordination page. Each save writes one history entry per changed field with its previous and new value, the Coordinator, and the time.
- **Significant-change warning**: the form treats a change to the proposed dates and times, expected attendance, venue requirements, or equipment requirements as significant. It names each held booking, tentative hold, and reservation, or says none is held, before the save, and the server refuses a significant change without the acknowledgement. Once saved, the Venue Staff on each approved booking and each Technical Support member holding a reservation get a notice, and the save changes no arrangement.
- **Cancellation requests**: the Organiser asks for cancellation of their event from the event request page, one waiting at a time, with no deadline. The event status stays unchanged until the Coordinator processes the request, and the assigned Coordinator gets a notice.
- **Cancellation processing**: the assigned Coordinator cancels the event, recording who and when, or declines the request with a required reason. The page lists what the cancelled event still holds (approved bookings, tentative holds, equipment reservations), and nothing releases automatically. Venue Staff and Technical Support Staff holding arrangements, every registered Attendee including VIPs, and the Organiser get a notice, and a cancelled event refuses new bookings, reservations, holds, requests, and registrations.
- **Event completion**: the assigned Coordinator completes a confirmed event after the event's own end passes. Completion records who completed it and when, and blocks new venue bookings, equipment reservations, and registrations.

### Changed

- **Staff event page layout**: the staff event page shows a two-column record beside a sticky action rail, with the ownership summary split from the handover form and the venue as one card.
- **Seed catalogue**: the seed grows to 100 people, 47 venues, 7 equipment types, and 20 events, stays re-runnable, and keeps bookings inside operating hours. The seed sets a new shared password.
- **Performance**: mutation invalidations scope below the root, and staff sections load on demand. Event, equipment, and venue reads batch, with new indexes on venue periods, registration status, and the unread bell. Coverage gates, a slimmer unit env, a reused E2E server, and cached statics shorten the suites.
- **Continuous integration**: E2E and integration suites shard three ways with failure-only artifacts, and code-quality gates split into fast and slow jobs. Per-tier path filters merge into one list, Playwright browsers cache, and deploy polling hardens, with promotion gated on migration.
- **Toolchain**: Bun moves to 1.4.3 across the package manager, CI, and Dockerfile, and `type:check` runs `bun check`. Fourteen dependencies move to newer minor and patch versions, among them `logtape` 2.3.10 to 2.4.0 and the Sentry SDK 11.4.0 to 11.5.0, with `seroval` pinned to the patched 1.6.8.
- **Documentation**: code comments follow ASD-STE100 Simplified Technical English.

### Fixed

- A dummy `DATABASE_URL` keeps unit suites that import the environment green, and the integration suites isolate from the expanded seed catalogue: venue-staff fixtures check by containment, the Submitted badge scopes to one card, and the blocked-date fixture scopes to one venue.

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
