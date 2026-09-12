# Architecture

This project is opinionated towards [Bun](https://bun.sh/) and follows a modern SSR architecture using TanStack Start and Nitro.

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
│   │   ├── layout/       # Header and shell layout
│   │   ├── pages/        # Route-level page compositions
│   │   ├── providers/    # Client providers (theme)
│   │   └── ui/           # Reusable UI primitives
│   ├── db/               # Drizzle schema, client, and migrations
│   │   ├── drizzle/      # Generated SQL migrations (drizzle-kit)
│   │   ├── schema.ts     # Application tables — venue catalogue (re-exports the auth tables)
│   │   └── auth-schema.ts# Better Auth tables
│   ├── features/
│   │   ├── auth/         # Session helpers, role/function matrix, login/signup/reset forms
│   │   ├── emails/       # Email templates
│   │   └── venues/       # Venue record: Zod schema, server functions, form + read-only view
│   ├── lib/              # Shared integrations and utilities
│   │   ├── auth.ts       # Better Auth server config
│   │   ├── auth-client.ts# Better Auth React client
│   │   ├── logger.ts     # LogTape app logger and sink config
│   │   ├── mailer.ts     # Resend email sender (lazy init, optional)
│   │   ├── redis.ts      # Bun-native Redis client (optional)
│   │   ├── seo.ts        # SEO metadata, OpenGraph, structured data, crawler formats
│   │   ├── storage.ts    # Bun-native S3-compatible upload client (optional)
│   │   └── utils.ts
│   ├── routes/           # TanStack Router routes and API handlers
│   │   ├── __root.tsx    # App shell
│   │   ├── index.tsx     # Landing page
│   │   ├── login.tsx     # Auth route — redirects signed-in users
│   │   ├── signup.tsx    # Auth route — redirects signed-in users
│   │   ├── reset-password.tsx # Request a reset link, or set a new password with ?token=
│   │   ├── dashboard.tsx # Protected route — session summary, upload widget
│   │   ├── settings.tsx  # Protected route — profile, linked providers, delete account
│   │   ├── venues/
│   │   │   ├── index.tsx     # Role-gated (venue:read) — the catalogue
│   │   │   ├── new.tsx       # Role-gated (venue:create) — record a venue
│   │   │   └── $venueId.tsx  # Role-gated (venue:read) — edit with venue:update, else read-only
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

1. **Routing**: Managed by TanStack Router. `src/routes/__root.tsx` composes the shell, theme provider, header, and page outlet.
2. **SSR**: TanStack Start handles the initial HTML render on the server via Nitro.
3. **Protected routes**: `dashboard.tsx`, `settings.tsx` and the three `venues/` routes call `getCurrentUser()` in `beforeLoad`. Unauthenticated requests redirect to `/login`. The `venues/` routes additionally check a role (`can(user.role, { venue: [...] })`) and redirect to `/dashboard` or `/venues` when it fails. Auth routes (`/login`, `/signup`) redirect already-signed-in users to `/dashboard`.
4. **Server functions**: `listVenues`, `getVenue` and `saveVenue` in `src/features/venues/server-fns.ts`. A `createServerFn` endpoint is reachable without ever loading the route, so each handler re-reads the session and calls `requirePermission` itself rather than relying on the route guard, and converts the resulting `AuthorizationError` into a status-carrying `Response` at its boundary. The database and the table definitions are reached only through a dynamic `import()` inside the handler (`records.server.ts`), which keeps them out of the client bundle; see [Authorisation](#authorisation).
5. **Auth flow**: Forms in `src/features/auth/components/*` call `src/lib/auth-client.ts`. `/login` handles email + password sign-in. `/signup` handles email + password sign-up with role selection (`attendee` or `event_organiser`), holding the user on a "check your email" prompt; `/reset-password` both requests a reset link and consumes it (`?token=`).
6. **File uploads**: `src/routes/api/upload-url.ts` generates a presigned PUT URL (S3-compatible). The client uploads directly to storage; the server never proxies file bytes.

## Database & Migrations

PostgreSQL is accessed using [Drizzle ORM](https://orm.drizzle.team/) paired with Bun's native SQL driver (`bun:sql` via `drizzle-orm/bun-sql`).

- **Schemas**: Defined in `src/db/schema.ts` (application tables) and `src/db/auth-schema.ts` (Better Auth tables: `user` with `role`, `session`, `account`, `verification`).
- **Migrations Directory**: Configured in `drizzle.config.ts` to output migrations to `src/db/drizzle/`.
- **Generating Migrations**: When schema files are updated, run `bun run db:generate` to produce timestamped SQL migration files and update the snapshot journal in `src/db/drizzle/meta/`. Never handwrite SQL migrations.
- **Applying Migrations**: Run `bun run db:migrate` to execute pending SQL migrations against the configured database (`DATABASE_URL`). For quick local development without migration tracking, `bun run db:push` can be used.

For developer commands, seeding, and local workflows, see the [Development Guide](./DEVELOPMENT.md#database-management--migrations).

## Authentication

Handled by **Better Auth**. Supported flows:

- **Email + password** — sign up and sign in with a password. The sign-up form collects a name, email, password (with a confirmation field matched client-side only — the confirmation is never sent, so there is nothing for the server to compare) and user role (`attendee` or `event_organiser`, default `attendee`). Both roles come from `SelfAssignableRoleSchema` (`src/features/auth/schema/role.ts`), which is also wired as the `validator.input` on the Better Auth `role` field — the field is client-supplied, so without that validator any string would persist and a visitor could self-assign an internal role. Internal roles are never selectable here. See [Authorisation](#authorisation) for the full role list and the matrix that governs what each role may do. The sign-up and reset forms share `PasswordSchema` (`src/features/auth/schema/password.ts`): 8–128 characters with at least one number and one symbol. Better Auth of its own accord enforces only a length range, so a `hooks.before` middleware in `src/lib/auth.ts` re-applies the full schema to every endpoint that _sets_ a password (`/sign-up/email`, `/reset-password`, `/change-password`). `/sign-in/email` is deliberately excluded, so accounts whose password predates the policy can still sign in. Always available. Password hashes live in the `account.password` column. Sign-ups store the name supplied on the form (trimmed, 1-100 characters, enforced client-side) and are auto-signed-in (`requireEmailVerification` is off, so an unverified user can still sign in).
- **Email verification** — `emailVerification.sendOnSignUp` mails a link via the `VerificationEmail` template; Better Auth's own `/api/auth/verify-email` endpoint consumes it, so there is no app route for it.
- **Password reset** — `/reset-password` sends a link (1 hour expiry) via `ResetPasswordEmail`. Better Auth's callback bounces the emailed link off `/api/auth/reset-password/:token` and back to `/reset-password?token=…`, or `?error=INVALID_TOKEN` when it has expired. It does not create a session; the user signs in afterwards.

Rate limiting is configured at 20 requests per 60-second window using Better Auth's built-in `rateLimit` option.

## Authorisation

### Roles

`user.role` holds one of the five values in `RoleSchema` (`src/features/auth/schema/role.ts`); a person needing two roles holds two accounts. The column is plain `text` with no CHECK constraint, so the single-role guarantee is not structural — `can()` parses `RoleSchema` and fails closed, so a hand-written `"attendee,event_coordinator"` grants nothing rather than both.

`SelfAssignableRoleSchema` is the subset a stranger may pick at registration, and it — not `RoleSchema` — is wired to the Better Auth `role` validator, so widening the role list never widens what a visitor can claim. A `hooks.before` middleware in `src/lib/auth.ts` refuses `role` on `/api/auth/update-user` with a 403, so nobody re-grades their own account. The three internal roles therefore have no assignment mechanism yet; provisioning staff accounts is PTR-59.

### Role/function matrix

Source of truth is `src/features/auth/permissions.ts`, restated here and held to both by `tests/unit/auth-permissions.test.ts`. Rows arrive with the stories that build them, so only role-varying functions appear.

| Function        | Attendee | Event Organiser | Event Coordinator | Venue Staff | Technical Support Staff |
| --------------- | :------: | :-------------: | :---------------: | :---------: | :---------------------: |
| `upload:create` |    —     |       ✅        |        ✅         |     ✅      |           ✅            |
| `venue:read`    |    —     |        —        |        ✅         |     ✅      |           ✅            |
| `venue:create`  |    —     |        —        |         —         |     ✅      |            —            |
| `venue:update`  |    —     |        —        |         —         |     ✅      |            —            |

Two limits: `attendee` holds an empty role — `ac.newRole({})` authorizes nothing, which is the fail-closed default. And the attendee/organiser line is an entitlement boundary, not a security one — both roles are self-assignable, so anyone set on uploading can simply register again as an organiser. The `venue` rows (PTR-26) are the first internal/external split: both external roles hold nothing on the catalogue, so an organiser is refused a venue record on the server whichever way they reach it, and a request for an equipment function is still refused only because the resource is unknown.

### Enforcing it

Built with `createAccessControl` from `better-auth/plugins/access` — despite the import path, **not** a plugin, and never in `betterAuth({ plugins })`. The `admin` plugin was rejected: it adds ban and impersonation columns nothing asks for, redefines the `role` field this project already owns (as `input: false`, silently disabling the sign-up role selector), and reads a comma-separated string as several roles at once.

`permissions.ts` stays pure data because the browser imports it too — a server import there fails `bun run build` alone. The session-aware half is `requirePermission(user, request)` in `src/features/auth/session.ts`: `Unauthorized` without a session, `Forbidden` without the permission. It throws an `AuthorizationError` carrying the status the refusal deserves (401 or 403) rather than a bare `Error`, because criterion 2 asks for an authorisation error and not a generic failure. It stays an `Error` rather than a `Response` so it can be called directly from tests; the venue server functions convert it at their boundary — where a thrown `Response` is returned verbatim — which is how a direct POST gets the real 401/403 rather than a generic failure. `upload-url.ts` is a route handler and answers with `Response.json` itself. Hiding a control is presentation, not enforcement, so each entry point checks for itself:

- **Server functions** — `listVenues`, `getVenue` and `saveVenue` (`src/features/venues/server-fns.ts`) each read the session and call `requirePermission` inside the handler; the pure `handle*` functions in `records.server.ts` take the user as an argument so the integration tests exercise the same gate without HTTP. Note the order at the HTTP boundary: `.validator(parseVenueInput)` runs before the handler, so a malformed payload is refused with its first Zod message before the permission check is reached; a well-formed one from the wrong role gets `Forbidden`.
- **API route handlers** — `src/routes/api/upload-url.ts`, which calls `can()` next to its session check.
- **Route guards** — the three `venues/` routes check `can(user.role, { venue: ["read"] })` (or `["create"]`) in `beforeLoad` and redirect on failure. This is presentation only: the server function behind the page repeats the check.
- **The interface** — `src/routes/dashboard.tsx` asks `can()` before rendering the upload control and the Venues link; `$venueId.tsx` asks `venue:update` to choose between the form and the read-only view.

## Styling

**Tailwind CSS v4** is integrated via `@tailwindcss/vite`. Theme switching is class-based on the `html` element through `next-themes`.

## Observability

### LogTape + Sentry

LogTape provides the app logger in `src/lib/logger.ts`. The server bootstrap (`instrument.server.mjs`) initialises Sentry with:

- `sendDefaultPii: false` — PII is not forwarded by default.
- `tracesSampleRate: 0.1` — 10% of server traces are sampled to control cost.

Enable `sendDefaultPii: true` and raise `tracesSampleRate` only intentionally, after reviewing your data-handling obligations.
