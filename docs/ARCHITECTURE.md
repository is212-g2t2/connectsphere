# Architecture

This project is opinionated towards [Bun](https://bun.sh/) and follows a modern SSR architecture using TanStack Start and Nitro.

## Decision Records

Reasoning behind foundational choices lives in [`docs/adrs/`](./adrs/):

## Core Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) — full-stack React with TanStack Router, server functions, and SSR.
- **Server**: [Nitro](https://nitro.unjs.io/) — handles server-side logic and deployment presets.
- **ORM & Database**: [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`) — high-performance, zero-dependency PostgreSQL access.
- **Auth**: [Better Auth](https://better-auth.com/) — email + password authentication with five user roles, two of them self-assignable at registration (`attendee`, `event_organiser`). Rate limited at the Better Auth layer (20 req/60 s).
- **Theme**: [next-themes](https://github.com/pacocoursey/next-themes) — class-based theme management on `html` with a mounted client toggle.

## Directory Structure

```
.
├── docs/
│   ├── adrs/             # Architecture decision records
│   ├── ARCHITECTURE.md   # This file
│   ├── CHANGELOG.md      # Release history
│   ├── CONTRIBUTING.md   # Branch, commit, and test conventions
│   ├── DEPLOYMENT.md     # Local Docker workflow and hosting trade-offs
│   ├── DESIGN.md         # Visual system notes
│   └── DEVELOPMENT.md    # Local setup, scripts, database, and testing guide
├── AGENTS.md             # Developer guide for agents (also CLAUDE.md)
├── CLAUDE.md             # Claude Code entry point — includes AGENTS.md
├── src/
│   ├── components/
│   │   ├── layout/       # Header and the HTML document shell every render is wrapped in
│   │   ├── pages/        # The error view and the root route's error/not-found boundaries
│   │   ├── providers/    # Client providers (theme)
│   │   └── ui/           # Reusable UI primitives
│   ├── db/               # Drizzle schema, client, and migrations
│   │   ├── drizzle/      # Generated SQL migrations (drizzle-kit)
│   │   ├── schema.ts     # Application tables (re-exports the auth tables)
│   │   └── auth-schema.ts# Better Auth tables
│   ├── features/         # Each feature owns its page views under `components/` (PTR-75)
│   │   ├── auth/         # Session helpers, role/function matrix, login/signup/reset/settings views
│   │   ├── dashboard/    # The signed-in home view and its upload card
│   │   ├── emails/       # Email templates
│   │   ├── event-requests/ # Full requirement capture: Zod schema, form, page, draft persistence
│   │   │   └── drafts.server.ts # Server-only draft writes; never client-reachable
│   │   ├── landing/      # The public landing view
│   │   └── venues/       # Venue record: Zod schema, server functions, form, pages + read-only view
│   ├── hooks/            # Client hooks shared across features
│   │   ├── use-mutation.ts # One mutation's in-flight flag, result and error (useActionState)
│   │   └── use-mobile.ts # Viewport-width media query
│   ├── lib/              # Shared integrations and utilities
│   │   ├── auth.server.ts # Better Auth server config
│   │   ├── auth-client.ts# Better Auth React client
│   │   ├── logger.ts     # LogTape app logger and sink config
│   │   ├── mailer.server.ts # Resend email sender (lazy init, optional)
│   │   ├── redis.server.ts # Bun-native Redis client (optional)
│   │   ├── seo.ts        # SEO metadata, OpenGraph, structured data, crawler formats
│   │   ├── storage.server.ts # Bun-native S3-compatible upload client (optional)
│   │   └── utils.ts
│   ├── routes/           # Routing only — search validation, guards, loaders, metadata (PTR-75)
│   │   ├── __root.tsx    # Document metadata, the session, the shell, and the error/not-found boundaries
│   │   ├── index.tsx     # Landing page
│   │   ├── login.tsx     # Auth route — redirects signed-in users
│   │   ├── signup.tsx    # Auth route — redirects signed-in arrivals
│   │   ├── reset-password.tsx # Request a reset link, or set a new password with ?token=
│   │   ├── _authenticated.tsx # Session boundary — narrows the root's user, else redirects to /login
│   │   ├── _authenticated/
│   │   │   ├── dashboard.tsx # Session summary, upload widget
│   │   │   ├── event-requests.tsx # Capture event requirements as a draft (organisers)
│   │   │   ├── settings.tsx  # Profile, linked providers, delete account
│   │   │   └── venues/
│   │   │       ├── index.tsx     # Role-gated (venue:read) — the catalogue
│   │   │       ├── new.tsx       # Role-gated (venue:create) — record a venue
│   │   │       └── $venueId.tsx  # Role-gated (venue:read) — edit with venue:update, else read-only
│   │   ├── robots[.]txt.ts   # Plain text crawler directives
│   │   ├── sitemap[.]xml.ts  # XML sitemap
│   │   └── api/
│   │       ├── auth/$.ts    # Better Auth handler
│   │       ├── health.ts
│   │       └── upload-url.ts# Presigned PUT URL — guarded by session and by role
│   └── globals.css       # Global styles (Tailwind CSS v4)
├── tests/                # Vitest and Playwright suites
├── instrument.server.mjs # Server bootstrap — Sentry init and logging
├── components.json       # shadcn/ui configuration
├── Dockerfile
├── drizzle.config.ts
└── package.json
```

## Data Flow

1. **Routing**: Managed by TanStack Router. A route module is wiring only — search validation, guards, loaders, metadata and the pending/error components — and its page view lives in the matching feature under `src/features/<feature>/components/`, reached as `component: () => <Page {...Route.use*()} />`. The view takes its route data as props, so it renders in a unit test without a router; `tests/unit/route-module-boundaries.test.ts` fails if a page component or a presentation helper is declared in a route file again. `src/routes/__root.tsx` wires the document metadata, the shell (`src/components/layout/root-document.tsx` — theme provider, header, outlet, toaster) and the two boundaries that re-render it (`src/components/pages/error.tsx`).
2. **SSR**: TanStack Start handles the initial HTML render on the server via Nitro.
3. **Protected routes**: `src/routes/__root.tsx` resolves the session once per navigation in `beforeLoad` — for every route, so the header outside the boundary renders the user in the server markup — and puts it on route context. The `src/routes/_authenticated.tsx` pathless layout route narrows that to a signed-in user and redirects unauthenticated visitors to `/login`; `dashboard`, `settings`, `event-requests` and the three `venues/` routes live under it and read the inherited `context.user` instead of calling `getCurrentUser()` themselves. `event-requests.tsx` and the `venues/` routes still check a role (`can(context.user.role, { venue: [...] })`) in their own `beforeLoad` and redirect to `/dashboard` or `/venues` when it fails. Auth routes (`/login`, `/signup`) redirect already-signed-in users to `/dashboard`; `/signup` refuses only an arrival (`cause === "enter"`), because signing up creates the session without leaving the route and the form re-resolves the context so the header picks it up.
4. **Server functions**: every `createServerFn` is a directly addressable HTTP route, so session and permission enforcement runs in a TanStack Start middleware pipeline rather than in the route guard or the handler. `withSession` (`src/features/auth/session.ts`) resolves the Better Auth session once and puts the sanitised user on the context; `requireSession` adds the 401; `requirePermission(request)` — or `requirePermission(data => request)` where the permission depends on the payload, as `saveVenue`'s create-versus-update split does — adds the 403. The `handle*` functions in `drafts.server.ts` and `records.server.ts` are then pure database work: they take the verified user only where a row needs an owner, and run no session lookup or `can()` check of their own. The pipeline is also the refusal boundary for the two status-carrying errors a handler may still throw: `AuthorizationError` (403 for a draft that belongs to another organiser) and `NotFoundError` (404, thrown by `saveVenue` when the row it was asked to update is not there; `getVenue` answers a missing row with `null` instead, which `$venueId.tsx` turns into the router's own `notFound()`). Either becomes a status `Response` — a thrown `Response` is returned verbatim — so a direct POST gets the real status. An in-app caller receives that `Response` as a _resolved value_, not a rejection (the server stamps it `x-tss-raw` and `serverFnFetcher` returns it before its `!response.ok` check), so every in-app call site routes the result through `unwrapRefusal` in the same module, which rethrows the refusal body as an `Error` — a missing record carries its own server message instead of the role-refusal sentence. `parseDraftInput` validates every supplied value — each proposed window's end later than its start, attendance and equipment quantities positive whole numbers, event name and purpose within their length limits — while blank inputs may be omitted from a save and default to empty values, because the request remains a draft until PTR-13 submits it. The database work lives in `drafts.server.ts` and `records.server.ts`, each reached by dynamic `import()` inside its handler: a static import of `#/db/schema` would ship every table definition to the browser without failing the build, so `server-fns.ts` stays free of server imports and `tests/unit/client-bundle-safety.test.ts` holds it there. See [Authorisation](#authorisation).
5. **Client mutations**: every browser write a form does not own — saving a draft, deleting an account, signing out, uploading a file — runs through `useMutation` (`src/hooks/use-mutation.ts`), a thin wrapper over React's `useActionState` (PTR-71). It holds the run's in-flight flag, its result and its error in one place, so a button disables itself for exactly as long as its mutation is open and a rejection becomes the action's error state rather than an unhandled promise. The run also receives whatever the last _successful_ run returned, which is how a server-assigned id reaches the next call: `request-page.tsx` saves a new draft, and the next save carries the id the server handed back without the page storing it. That result survives a later failure, so a retry after a refused save updates the same row instead of inserting beside it. A form keeps its own submitting flag and error map — `mutate` returns the settled state and never rejects, so the form's `onSave` decides for itself what a failure means there.
6. **Auth flow**: Forms in `src/features/auth/components/*` call `src/lib/auth-client.ts`. `/login` handles email + password sign-in. `/signup` handles email + password sign-up with role selection (`attendee` or `event_organiser`), holding the user on a "check your email" prompt; `/reset-password` both requests a reset link and consumes it (`?token=`).
7. **File uploads**: `src/routes/api/upload-url.ts` generates a presigned PUT URL (S3-compatible). The client uploads directly to storage; the server never proxies file bytes.

## Database & Migrations

PostgreSQL is accessed using [Drizzle ORM](https://orm.drizzle.team/) paired with Bun's native SQL driver (`bun:sql` via `drizzle-orm/bun-sql`).

- **Schemas**: Defined in `src/db/schema.ts` (application tables) and `src/db/auth-schema.ts` (Better Auth tables: `user` with `role`, `session`, `account`, `verification`).
- **Migrations Directory**: Configured in `drizzle.config.ts` to output migrations to `src/db/drizzle/`.
- **Generating Migrations**: When schema files are updated, run `bun run db:generate` to produce timestamped SQL migration files and update the snapshot journal in `src/db/drizzle/meta/`. Never handwrite SQL migrations.
- **Applying Migrations**: Run `bun run db:migrate` to execute pending SQL migrations against the configured database (`DATABASE_URL`). For quick local development without migration tracking, `bun run db:push` can be used.

For developer commands, seeding, and local workflows, see the [Development Guide](./DEVELOPMENT.md#database-management--migrations).

## Authentication

Handled by **Better Auth**. Supported flows:

- **Email + password** — sign up and sign in with a password. The sign-up form collects a name, email, password (with a confirmation field matched client-side only — the confirmation is never sent, so there is nothing for the server to compare) and user role (`attendee` or `event_organiser`, default `attendee`). Both roles come from `SelfAssignableRoleSchema` (`src/features/auth/schema/role.ts`), which is also wired as the `validator.input` on the Better Auth `role` field — the field is client-supplied, so without that validator any string would persist and a visitor could self-assign an internal role. Internal roles are never selectable here. See [Authorisation](#authorisation) for the full role list and the matrix that governs what each role may do. The sign-up and reset forms share `PasswordSchema` (`src/features/auth/schema/password.ts`): 8–128 characters with at least one number and one symbol. Better Auth of its own accord enforces only a length range, so a `hooks.before` middleware in `src/lib/auth.server.ts` re-applies the full schema to every endpoint that _sets_ a password (`/sign-up/email`, `/reset-password`, `/change-password`). `/sign-in/email` is deliberately excluded, so accounts whose password predates the policy can still sign in. Always available. Password hashes live in the `account.password` column. Sign-ups store the name supplied on the form (trimmed, 1-100 characters, enforced client-side) and are auto-signed-in (`requireEmailVerification` is off, so an unverified user can still sign in).
- **Email verification** — `emailVerification.sendOnSignUp` mails a link via the `VerificationEmail` template; Better Auth's own `/api/auth/verify-email` endpoint consumes it, so there is no app route for it.
- **Password reset** — `/reset-password` sends a link (1 hour expiry) via `ResetPasswordEmail`. Better Auth's callback bounces the emailed link off `/api/auth/reset-password/:token` and back to `/reset-password?token=…`, or `?error=INVALID_TOKEN` when it has expired. It does not create a session; the user signs in afterwards.

Rate limiting is configured at 20 requests per 60-second window using Better Auth's built-in `rateLimit` option.

## Authorisation

### Roles

`user.role` holds one of the five values in `RoleSchema` (`src/features/auth/schema/role.ts`); a person needing two roles holds two accounts. The column is plain `text` with no CHECK constraint, so the single-role guarantee is not structural — `can()` parses `RoleSchema` and fails closed, so a hand-written `"attendee,event_coordinator"` grants nothing rather than both.

`SelfAssignableRoleSchema` is the subset a stranger may pick at registration, and it — not `RoleSchema` — is wired to the Better Auth `role` validator, so widening the role list never widens what a visitor can claim. A `hooks.before` middleware in `src/lib/auth.server.ts` refuses `role` on `/api/auth/update-user` with a 403, so nobody re-grades their own account. The three internal roles therefore have no assignment mechanism yet; provisioning staff accounts is PTR-59.

### Role/function matrix

Source of truth is `src/features/auth/permissions.ts`, restated here and held to both by `tests/unit/auth-permissions.test.ts`. Rows arrive with the stories that build them, so only role-varying functions appear.

| Function               | Attendee | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff |
| ---------------------- | :------: | :-------------: | :---------------: | :---------: | :---------------------: |
| `upload:create`        |    —     |       ✅        |        ✅         |     ✅      |           ✅            |
| `event_request:create` |    —     |       ✅        |         —         |      —      |            —            |
| `venue:read`           |    —     |        —        |        ✅         |     ✅      |           ✅            |
| `venue:create`         |    —     |        —        |         —         |     ✅      |            —            |
| `venue:update`         |    —     |        —        |         —         |     ✅      |            —            |

Two limits: `attendee` holds an empty role — `ac.newRole({})` authorizes nothing, which is the fail-closed default. And the attendee/organiser line is an entitlement boundary, not a security one — both roles are self-assignable, so anyone set on uploading or starting an event request can simply register again as an organiser. The `venue` rows (PTR-26) are the first internal/external split: both external roles hold nothing on the catalogue, so an organiser is refused a venue record on the server whichever way they reach it, and a request for an equipment function is still refused only because the resource is unknown.

### Enforcing it

Built with `createAccessControl` from `better-auth/plugins/access` — despite the import path, **not** a plugin, and never in `betterAuth({ plugins })`. The `admin` plugin was rejected: it adds ban and impersonation columns nothing asks for, redefines the `role` field this project already owns (as `input: false`, silently disabling the sign-up role selector), and reads a comma-separated string as several roles at once.

`permissions.ts` stays pure data because the browser imports it too — a server import there fails `bun run build` alone. The session-aware half lives in `src/features/auth/session.ts` and is now a middleware pipeline: `withSession` resolves the session and converts the two status-carrying errors a handler may still throw into a status `Response`; `requireSession` refuses a missing session with 401 `Unauthorized`; `requirePermission(request)` refuses a role the matrix does not grant with 403 `Forbidden`. Those are the refusal responses a direct HTTP call receives. `upload-url.ts` is the one remaining route handler and answers with `Response.json` itself. Hiding a control is presentation, not enforcement, so every server function runs behind the pipeline:

- **Server functions** — every `createServerFn` in `src/features/` declares `.middleware([...])`; `tests/unit/server-function-middleware.test.ts` fails the suite if one does not, and `tests/integration/server-function-authorization.test.ts` runs the pipeline for a server function of each feature, covering the 401 and 403 paths and asserting that the handler below a refusal never ran. Because the middleware runs before the function's own `.validator()`, a refused role gets `Forbidden` even for a malformed payload, while a permitted one still gets the first Zod message.
- **API route handlers** — `src/routes/api/upload-url.ts`, which calls `can()` next to its session check.
- **Route guards** — `src/routes/__root.tsx` resolves the session once per navigation and puts the user on route context; `src/routes/_authenticated.tsx` narrows it and redirects unauthenticated visitors to `/login`; the child routes then check `can(context.user.role, { venue: ["read"] })` (or `["create"]`) in their own `beforeLoad`, redirecting on failure. This is presentation only: the middleware behind the page repeats the check.
- **The interface** — the page views ask the same `can()` of the user their route hands them: `src/features/dashboard/components/dashboard-page.tsx` before rendering the upload control and the Event requests or Venues links, and `src/features/venues/components/venue-detail-page.tsx` before choosing between the form and the read-only view. `src/routes/_authenticated/event-requests.tsx` redirects a role the matrix refuses in its `beforeLoad`, because a redirect is routing.

## Styling

**Tailwind CSS v4** is integrated via `@tailwindcss/vite`. Theme switching is class-based on the `html` element through `next-themes`.

## Observability

### LogTape + Sentry

LogTape provides the app logger in `src/lib/logger.ts`. The server bootstrap (`instrument.server.mjs`) initialises Sentry with:

- `sendDefaultPii: false` — PII is not forwarded by default.
- `tracesSampleRate: 0.1` — 10% of server traces are sampled to control cost.

Enable `sendDefaultPii: true` and raise `tracesSampleRate` only intentionally, after reviewing your data-handling obligations.
