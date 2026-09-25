# Architecture

ConnectSphere is opinionated towards [Bun](https://bun.sh/): a full-stack React application rendered on the server by TanStack Start over Nitro.

## Stack

- **Framework**: [TanStack Start](https://tanstack.com/start). Full-stack React with TanStack Router, server functions, and SSR.
- **Server**: [Nitro](https://nitro.unjs.io/). Server-side logic and deployment presets.
- **ORM & Database**: [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`), PostgreSQL with no extra dependency.
- **Auth**: [Better Auth](https://better-auth.com/). Email + password authentication with a five-role permission model.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`. The visual system and its tokens are in [`DESIGN.md`](./DESIGN.md).
- **Theme**: [next-themes](https://github.com/pacocoursey/next-themes). Class-based on `html`, with a mounted client toggle.

## Decision Records

Reasoning behind foundational choices lives in [`docs/adrs/`](./adrs/):

- [ADR-1: TanStack Start over Next.js or a split frontend–backend app](./adrs/ADR-1-tanstack-start.md)
- [ADR-2: Modular monolith over microservices](./adrs/ADR-2-monolith.md)
- [ADR-3: Google Cloud Run in a single GCP project](./adrs/ADR-3-cloud-run.md)
- [ADR-4: Trunk-based main with release-gated production](./adrs/ADR-4-trunk-based-main.md)
- [ADR-5: Overlap-free approved bookings, enforced by a Postgres exclusion constraint](./adrs/ADR-5-venue-booking-overlap.md)

## Directory Structure

```
.
├── docs/
│   ├── adrs/             # Architecture decision records
│   ├── ARCHITECTURE.md   # This file
│   ├── CONTRIBUTING.md   # Branch, commit, and test conventions
│   ├── DEPLOYMENT.md     # Environments, release pipeline, local Docker workflow
│   ├── DESIGN.md         # Visual system and tokens
│   └── DEVELOPMENT.md    # Setup, scripts, database, and testing
├── src/
│   ├── components/
│   │   ├── layout/       # Header, the shared page shell and the HTML document shell
│   │   ├── pages/        # Error view and route boundaries
│   │   ├── providers/    # Client providers (theme)
│   │   └── ui/           # Reusable UI primitives (shadcn/ui)
│   ├── db/               # Drizzle schema and generated migrations
│   ├── features/         # One directory per feature: page views under
│   │   │                 # components/, Zod schemas, server functions, and
│   │   │                 # feature-local *.server.ts modules
│   │   ├── auth/         # Sessions, permissions, login/signup/reset/settings
│   │   ├── coordination/ # Coordinator assignments and pickups
│   │   ├── dashboard/    # Signed-in home view
│   │   ├── emails/       # Email templates
│   │   ├── event-requests/ # Requirement capture, drafts, submission
│   │   ├── events/       # Relationship-scoped event access
│   │   ├── landing/      # Public landing view
│   │   ├── venue-requests/ # Booking requests: raise, withdraw, approve, notify
│   │   └── venues/       # Venue catalogue, requirements search with suitability verdicts, and availability
│   ├── hooks/            # Client hooks shared across features
│   ├── lib/              # Shared integrations (auth, mail, storage, logger, SEO)
│   └── routes/           # Routing only: wiring, guards, loaders, metadata
│       ├── __root.tsx    # Metadata, session resolution, shell, error boundaries
│       ├── _authenticated.tsx # Session boundary: children require a sign-in
│       ├── _authenticated/    # dashboard, settings, coordination, event-requests, venues
│       │   └── venue-requests/ # Pending booking request queue and detail
│       ├── api/          # Better Auth handler, health, smoke, upload-url
│       └── robots[.]txt.ts, sitemap[.]xml.ts
├── tests/                # Vitest and Playwright suites
├── CHANGELOG.md          # Release history
├── instrument.server.mjs # Server process preload: Sentry init (logging is configured in src/server.ts)
├── AGENTS.md             # Guide for AI agents (CLAUDE.md symlinks to it)
├── components.json       # shadcn/ui configuration
├── Dockerfile
├── drizzle.config.ts
└── package.json
```

## Data Flow

1. **Routing**: TanStack Router. A route module is wiring only: search validation, guards, loaders, metadata, pending and error components. The view is a feature component (`src/features/<feature>/components/<page>-page.tsx`) taking its route data as props, bound with `component: () => <Page {...Route.use*()} />`, so it renders in a unit test without a router. `tests/unit/route-module-boundaries.test.ts` enforces the split.
2. **SSR**: TanStack Start renders the initial HTML through Nitro.
3. **Sessions**: `src/routes/__root.tsx` resolves the session once per navigation in `beforeLoad`, for every route, so the header renders the user in the server markup. `src/routes/_authenticated.tsx` narrows it to a signed-in user and redirects visitors to `/login`; its children read the inherited `context.user` rather than calling `getCurrentUser()` themselves. The role-gated routes repeat a `can()` check in their own `beforeLoad` and redirect on failure. Auth routes redirect already-signed-in users to `/dashboard`.
4. **Server functions**: every `createServerFn` is a directly addressable HTTP route, so authorization runs in middleware, never in the route guard or the handler. Handlers do pure database work: no session lookup and no `can()` of their own. The full model is [Authorisation](#authorisation).
5. **Client mutations**: browser writes a form does not own (save a draft, delete an account, sign out, upload) run through `useMutation` (`src/hooks/use-mutation.ts`), a thin wrapper over React's `useActionState` holding the run's in-flight flag, result and error. The run receives the last _successful_ result, which is how a server-assigned draft id reaches the next save without the page storing it.
6. **Auth flow**: forms in `src/features/auth/components/` call `src/lib/auth-client.ts`; `/login`, `/signup` and `/reset-password` (`?token=`) are the routes.
7. **File uploads**: `src/routes/api/upload-url.ts` generates a presigned PUT URL; the client uploads directly to storage and the server never proxies file bytes.

## Database & Migrations

PostgreSQL is accessed with Drizzle ORM and Bun's native SQL driver (`bun:sql` via `drizzle-orm/bun-sql`).

- **Schemas**: `src/db/schema.ts` (application tables, re-exporting the auth tables) and `src/db/auth-schema.ts` (Better Auth: `user` with `role`, `session`, `account`, `verification`).
- **Migrations**: generated by Drizzle Kit into `src/db/drizzle/`. Run `bun run db:generate` after any schema change and `bun run db:migrate` to apply; never handwrite SQL, except the one reviewed exemption: the booking exclusion constraint Drizzle cannot express, added with `db:generate --custom` ([ADR-5](./adrs/ADR-5-venue-booking-overlap.md)). Workflow: [`DEVELOPMENT.md`](./DEVELOPMENT.md#database-management--migrations).

## Authentication

Handled by **Better Auth**; rate limited to 20 requests per 60-second window.

- **Email + password**: the sign-up form collects name, email, password (confirmation matched client-side only, never sent) and a role. Password hashes live in `account.password`; sign-ups are auto-signed-in, so an unverified user can still sign in.
- **Password policy**: `PasswordSchema` (`src/features/auth/schema/password.ts`) requires 8–128 characters with a number and a symbol. Better Auth enforces only a length range of its own accord, so a `hooks.before` middleware in `src/lib/auth.server.ts` re-applies the full schema to every endpoint that _sets_ a password (`/sign-up/email`, `/reset-password`, `/change-password`). `/sign-in/email` is deliberately excluded, so accounts predating the policy can still sign in.
- **Email verification**: `emailVerification.sendOnSignUp` mails a link via the `VerificationEmail` template; Better Auth's `/api/auth/verify-email` consumes it, so there is no app route for it.
- **Password reset**: `/reset-password` sends a link (1 hour expiry). The emailed callback returns to `/reset-password?token=…`, or `?error=INVALID_TOKEN` when it has expired. It does not create a session; the user signs in afterwards.

## Venue suitability

`evaluateVenueSuitability` (`src/features/venues/records.server.ts`) checks every applied requirement — capacity, location, layout, accessibility and facility phrases, availability for the window — and returns `{ suitable, failures }` with each failing criterion named in a sentence. `handleSearchVenues` sorts the catalogue by that verdict into `venues` and `unsuitable`, and the `/venues` page lists the shortfalls beneath the results. A verdict writes nothing; Venue Staff still decide every request.

Availability is operating hours minus recorded unavailability and the approved bookings `loadVenueBookings` supplies, as floating venue-local timestamps (`src/features/venues/availability.ts`); the search and the availability calendar read the same loader, and an approved venue request _is_ the booking. Approvals cannot overlap for one venue: a partial exclusion constraint (ADR-5) refuses the second, and the refusal names the venue and period. Search from an event accepts `submitted`, `under_review`, `awaiting_organiser`, `approved` and `planning`, and refuses the rest without revealing whether the event exists.

## Authorisation

### Roles

`user.role` holds one of the five values in `RoleSchema` (`src/features/auth/schema/role.ts`); a person needing two roles holds two accounts. The column is plain `text` with no CHECK constraint, so the single-role guarantee is not structural. `can()` parses `RoleSchema` and fails closed, so a hand-written `"attendee,event_coordinator"` grants nothing rather than both.

`SelfAssignableRoleSchema` is the subset a stranger may pick at registration (`attendee`, `event_organiser`), and that schema, not `RoleSchema`, is wired to the Better Auth `role` field's `validator.input`, so widening the role list never widens what a visitor can claim. A `hooks.before` middleware in `src/lib/auth.server.ts` refuses `role` on `/api/auth/update-user` with a 403, so nobody re-grades their own account. The three internal roles are provisioned by `bun run db:seed` (`scripts/seed.ts`); no self-service path reaches them.

### Role/function matrix

Source of truth is `src/features/auth/permissions.ts`, held to this table by `tests/unit/auth-permissions.test.ts`. Only role-varying functions appear.

| Function                   | Attendee | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff |
| -------------------------- | :------: | :-------------: | :---------------: | :---------: | :---------------------: |
| `upload:create`            |    —     |       ✅        |        ✅         |     ✅      |           ✅            |
| `event_request:create`     |    —     |       ✅        |         —         |      —      |            —            |
| `event_request:coordinate` |    —     |        —        |        ✅         |      —      |            —            |
| `venue:read`               |    —     |        —        |        ✅         |     ✅      |           ✅            |
| `venue:search`             |    —     |        —        |        ✅         |      —      |            —            |
| `venue:create`             |    —     |        —        |         —         |     ✅      |            —            |
| `venue:update`             |    —     |        —        |         —         |     ✅      |            —            |
| `venue_request:request`    |    —     |        —        |        ✅         |      —      |            —            |
| `venue_request:read`       |    —     |        —        |         —         |     ✅      |            —            |
| `venue_request:decide`     |    —     |        —        |         —         |     ✅      |            —            |

`attendee` holds an empty role: `ac.newRole({})` authorizes nothing, the fail-closed default. The attendee/organiser line is an entitlement boundary, not a security one: both roles are self-assignable, so anyone set on uploading can register again as an organiser. `event_request:coordinate` is deliberately disjoint from `create`. All three internal roles may read the venue catalogue and availability; only Event Coordinators may search it against event requirements, and only Venue Staff may create or update records. `venue_request:request` is the Coordinator's raise-and-withdraw verb. Raising re-reads the event's assignment, so it acts only on the caller's own submitted event; withdrawing authorizes on the request's raiser, so the raiser keeps the power while the request is pending, even after the event moves past `submitted` or is reassigned; the new assignee cannot withdraw a request they did not raise. `venue_request:read` is the Venue Staff shared pending queue and read-only detail permission; it is separate from `venue_request:decide`, so reading the queue does not grant approval authority. `venue_request:decide` is Venue Staff's approval verb; the handler re-reads the shared-queue rule, so a row assigned to another staff member is refused. Equipment functions are absent because the resource does not exist yet.

### Enforcing it

Built with `createAccessControl` from `better-auth/plugins/access`. Despite the import path, it is **not** a plugin and never goes to `betterAuth({ plugins })`. The `admin` plugin was rejected: it adds columns nothing asks for, redefines the `role` field this project owns (silently disabling the sign-up role selector), and reads a comma-separated string as several roles at once.

`permissions.ts` stays pure data because the browser imports it too; the session-aware half is the middleware pipeline in `src/features/auth/session.ts`. Every server function runs behind it:

| Layer                  | Enforcement                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server functions**   | `.middleware([...])` on every `createServerFn`: `withSession` resolves the session, `requireSession` answers 401, `requirePermission(...)` answers 403, or takes an accessor where the permission depends on the payload, as `saveVenue`'s create-versus-update split does. |
| **API route handlers** | `src/routes/api/upload-url.ts` calls `can()` beside its session check, the one handler outside the pipeline.                                                                                                                                                                |
| **Route guards**       | `beforeLoad` redirects and role checks, presentation only; the middleware behind the page repeats the check.                                                                                                                                                                |
| **The interface**      | Page views ask `can()` of their route's user, for example to choose between the venue form and its read-only view. Hiding a control is presentation, never enforcement.                                                                                                     |

Because the middleware runs before a server function's own `.validator()`, a refused role gets 403 even for a malformed payload, while a permitted one still gets the first Zod message. The behavioural half is `tests/integration/server-function-authorization.test.ts`: 401 and 403, with the handler never running.

### Refusals

A handler or middleware throws a typed `Error` subclass when refusing a request: `AuthorizationError` (401 or 403), `NotFoundError` (404), or `ConflictError` (409). The middleware pipeline (`withSession`, `requireSession`, and `requirePermission`) calls `setResponseStatus` so the HTTP response on the wire carries the matching status code.

Seroval serializes these errors across the network boundary. Callers and SSR reject with a standard `Error` naturally without caller-side response unwrapping.

## Observability

LogTape provides the app logger in `src/lib/logger.ts`, configured from `src/server.ts` so the built server needs no source tree beside it. The console sink prints each event's structured properties after its message, and `maskEmail` (`src/lib/utils.ts`) masks email addresses before they are logged. The server process preloads `instrument.server.mjs`, which initialises Sentry with:

- `sendDefaultPii: false`, so PII is not forwarded by default.
- `tracesSampleRate: 0.1`, so 10% of server traces are sampled to control cost.

Enable `sendDefaultPii: true` and raise `tracesSampleRate` only intentionally, after reviewing your data-handling obligations.
