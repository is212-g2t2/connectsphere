# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
