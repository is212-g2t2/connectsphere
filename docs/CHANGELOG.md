# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **External account registration** (PTR-5): visitors self-register as Event Organiser or Attendee, supplying name, password confirmation and role. `POST /sign-up/email` validates the role against a self-assignable enum, so an internal role cannot be claimed at sign-up.
- **Password policy** (PTR-5): enforced server-side on sign-up, reset and change; a failing password is refused with the specific rule it broke, not a generic error.
- **Role/function matrix** (PTR-7): five roles — `attendee`, `event_organiser`, `event_coordinator`, `venue_staff`, `technical_support_staff`. Declared once in `src/features/auth/permissions.ts` and mirrored in [ARCHITECTURE.md](./ARCHITECTURE.md#authorisation); enforced on server functions, `POST /api/upload-url`, and the interface.
- **Seeding** (PTR-59): `bun run db:seed` creates one Event Coordinator, one Venue Staff and one Technical Support Staff account, each with a working credential for direct sign-in, plus three demo venues with their full catalogue attributes and two future periods of unavailability. Re-runnable without duplicating records; demo credentials documented in [README.md](../README.md).
- **Draft event requests** (PTR-9): an Event Organiser can start a request at `/event-requests` and save it before it is complete. The draft is stored with status `draft` (a Postgres enum, so no other value can reach the column), belongs only to the organiser who created it, and has no Coordinator assigned; supplied fields are still validated — an end date/time not later than its start, a non-positive whole attendance, or over-long free text is refused — while blank fields may be omitted. Saving again during the same sitting edits that draft rather than opening a second one; resuming one in a later sitting is PTR-12.
- **Full event requirements** (PTR-10): the request form captures event name, purpose, one or more proposed date/time windows and expected attendance, plus the optional description, event type, venue requirements, room-layout preference, accessibility requirements, special arrangements and repeatable equipment type/quantity lines. The core fields are marked required; every supplied value is validated on save (an end not later than its start, a non-positive whole attendance or equipment quantity, over-long text), while blank fields still save because a request stays a draft until PTR-13 submits it. Values are stored as text and JSONB so every one round-trips exactly as entered for PTR-12 to reopen.
- **Attendee registration terms** (PTR-11): the request form lets an organiser say whether attendees may register. Turning registration on requires a capacity, an opening date/time and a closing date/time together — the save is refused, naming each missing value, while any is absent, when the closing time is not later than the opening, or when the capacity is not a positive whole number. Turning it off requires nothing and writes no terms; a later save with registration off clears any that were stored. The invariant is held in Zod and by database CHECKs, and the window columns are text so the `datetime-local` values round-trip exactly.
- **Event request submission** (PTR-13): an organiser submits a saved draft from `/event-requests` — the draft is saved first, then either refused with every incomplete item named (a half-filled equipment line included) or flipped to `submitted` with the submission time recorded and a confirmation that replaces the form. A submitted request is no longer directly editable: the save path refuses it with a 409 and points at a clarification response (PTR-19) or a change request (PTR-51), and a database CHECK keeps a submitted row from existing without its time.
- **Venue records** (PTR-26): Venue Staff create and edit the venue catalogue under `/venues`, covering name, location, maximum capacity, facilities, accessibility features, supported room layouts and per-day operating hours. A capacity that is not a positive whole number is refused in Zod and by a database CHECK. Coordinators and Technical Support Staff get the record read-only; organisers and attendees are refused. Each save re-runs the route loader, so later searches and views read the new values rather than a stale copy.

### Changed

- Valid sign-ins route every role to `/dashboard`, which varies its contents by permission rather than sending roles to separate landing pages (PTR-6).
- The client-bundle safety guard scans every module under `src/features`, not only those exporting server functions (PTR-7).
- Server-function authorization moved onto a TanStack Start middleware pipeline (PTR-69): every `createServerFn` runs behind `withSession`/`requireSession`/`requirePermission`, which answer 401/403 before any handler or database work, and the per-feature boundary wrappers are gone.
- Client-side writes run through a managed action lifecycle rather than hand-rolled `useState` flags (PTR-71): a mutation-triggering button — account deletion and sign-out included — is disabled for exactly as long as its mutation is open, a rejection surfaces a message and returns the interface to an interactive state instead of stranding it, and a saved draft's id is applied by the action, so a second save edits that draft rather than opening another.

### Fixed

- Missing popover theme tokens left every dropdown surface transparent.

### Removed

- Email OTP sign-in, along with the `/verify-otp` route, its component and its email template.
- Passkey support and the `passkey` table; the `@better-auth/passkey` dependency is dropped.
- Google OAuth, along with the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables.
