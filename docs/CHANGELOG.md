# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **External account registration** (PTR-5): visitors self-register as Event Organiser or Attendee, supplying name, password confirmation and role. `POST /sign-up/email` validates the role against a self-assignable enum, so an internal role cannot be claimed at sign-up.
- **Password policy** (PTR-5): enforced server-side on sign-up, reset and change; a failing password is refused with the specific rule it broke, not a generic error.
- **Role/function matrix** (PTR-7): five roles — `attendee`, `event_organiser`, `event_coordinator`, `venue_staff`, `technical_support_staff`. Declared once in `src/features/auth/permissions.ts` and mirrored in [ARCHITECTURE.md](./ARCHITECTURE.md#authorisation); enforced on server functions, `POST /api/upload-url`, and the interface.
- **Staff account seeding** (PTR-59): `bun run db:seed` creates one Event Coordinator, one Venue Staff and one Technical Support Staff account, each with a working credential for direct sign-in. Re-runnable without duplicating records; demo credentials documented in [README.md](../README.md).
- **Draft event requests** (PTR-9): an Event Organiser can start a request at `/event-requests` and save it before it is complete. The draft is stored with status `draft` (a Postgres enum, so no other value can reach the column), belongs only to the organiser who created it, and has no Coordinator assigned; supplied fields are still validated — an end date/time not later than its start, a non-positive whole attendance, or over-long free text is refused — while blank fields may be omitted. Saving again during the same sitting edits that draft rather than opening a second one; resuming one in a later sitting is PTR-12.
- **Full event requirements** (PTR-10): the request form captures event name, purpose, one or more proposed date/time windows and expected attendance, plus the optional description, event type, venue requirements, room-layout preference, accessibility requirements, special arrangements and repeatable equipment type/quantity lines. The core fields are marked required; every supplied value is validated on save (an end not later than its start, a non-positive whole attendance or equipment quantity, over-long text), while blank fields still save because a request stays a draft until PTR-13 submits it. Values are stored as text and JSONB so every one round-trips exactly as entered for PTR-12 to reopen.

### Changed

- Valid sign-ins route every role to `/dashboard`, which varies its contents by permission rather than sending roles to separate landing pages (PTR-6).
- The client-bundle safety guard scans every module under `src/features`, not only those exporting server functions (PTR-7).

### Fixed

- Missing popover theme tokens left every dropdown surface transparent.

### Removed

- Email OTP sign-in, along with the `/verify-otp` route, its component and its email template.
- Passkey support and the `passkey` table; the `@better-auth/passkey` dependency is dropped.
- Google OAuth, along with the `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables.
