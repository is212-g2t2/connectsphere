# Architecture

This project is opinionated towards [Bun](https://bun.sh/) and follows a modern SSR architecture using TanStack Start and Nitro.

## Core Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) — full-stack React with TanStack Router, server functions, and SSR.
- **Server**: [Nitro](https://nitro.unjs.io/) — handles server-side logic and deployment presets.
- **ORM & Database**: [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`) — high-performance, zero-dependency PostgreSQL access.
- **Auth**: [Better Auth](https://better-auth.com/) — email + password authentication with user roles (`attendee`, `event_organiser`). Rate limited at the Better Auth layer (20 req/60 s).
- **Theme**: [next-themes](https://github.com/pacocoursey/next-themes) — class-based theme management on `html` with a mounted client toggle.

## Directory Structure

```
.
├── docs/
│   ├── ARCHITECTURE.md   # This file
│   ├── CHANGELOG.md      # Release history
│   ├── CONTRIBUTING.md   # Branch, commit, and test conventions
│   ├── DEPLOYMENT.md     # Hosting options and platform config
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
│   │   ├── schema.ts     # notes table (with userId FK)
│   │   └── auth-schema.ts# Better Auth tables
│   ├── features/
│   │   ├── auth/         # Session helpers and server fn, login/signup/reset forms
│   │   ├── emails/       # Email templates
│   │   └── notes/        # Notes server functions
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
│   │   ├── dashboard.tsx # Protected route — notes CRUD, upload widget
│   │   ├── settings.tsx  # Protected route — profile, linked providers, delete account
│   │   ├── sentry-example.tsx # Dev only
│   │   ├── robots[.]txt.ts   # Plain text crawler directives
│   │   ├── sitemap[.]xml.ts  # XML sitemap
│   │   └── api/
│   │       ├── auth/$.ts    # Better Auth handler
│   │       ├── health.ts
│   │       ├── upload-url.ts# Auth-guarded presigned PUT URL
│   │       └── sentry-example.ts # Dev only
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
3. **Protected routes**: `dashboard.tsx` and `settings.tsx` call `getCurrentUser()` in `beforeLoad`. Unauthenticated requests redirect to `/login`. Auth routes (`/login`, `/signup`) redirect already-signed-in users to `/dashboard`.
4. **Server functions**: `src/features/notes/server-fns.ts` exposes `listNotes`, `createNote`, and `deleteNote` via `createServerFn`. Each function re-checks the session server-side.
5. **Auth flow**: Forms in `src/features/auth/components/*` call `src/lib/auth-client.ts`. `/login` handles email + password sign-in. `/signup` handles email + password sign-up with role selection (`attendee` or `event_organiser`), holding the user on a "check your email" prompt; `/reset-password` both requests a reset link and consumes it (`?token=`).
6. **File uploads**: `src/routes/api/upload-url.ts` generates a presigned PUT URL (S3-compatible). The client uploads directly to storage; the server never proxies file bytes.

## Database & Migrations

PostgreSQL is accessed using [Drizzle ORM](https://orm.drizzle.team/) paired with Bun's native SQL driver (`bun:sql` via `drizzle-orm/bun-sql`).

- **Schemas**: Defined in `src/db/schema.ts` (application tables such as `notes`) and `src/db/auth-schema.ts` (Better Auth tables: `user` with `role`, `session`, `account`, `verification`).
- **Migrations Directory**: Configured in `drizzle.config.ts` to output migrations to `src/db/drizzle/`.
- **Generating Migrations**: When schema files are updated, run `bun run db:generate` to produce timestamped SQL migration files and update the snapshot journal in `src/db/drizzle/meta/`. Never handwrite SQL migrations.
- **Applying Migrations**: Run `bun run db:migrate` to execute pending SQL migrations against the configured database (`DATABASE_URL`). For quick local development without migration tracking, `bun run db:push` can be used.

For developer commands, seeding, and local workflows, see the [Development Guide](./DEVELOPMENT.md#database-management--migrations).

## Authentication

Handled by **Better Auth**. Supported flows:

- **Email + password** — sign up and sign in with a password. The sign-up form collects a name, email, password (with a confirmation field matched client-side only — the confirmation is never sent, so there is nothing for the server to compare) and user role (`attendee` or `event_organiser`, default `attendee`). Both roles come from `RoleSchema` (`src/features/auth/schema/role.ts`), which is also wired as the `validator.input` on the Better Auth `role` field — the field is client-supplied on `/sign-up/email` _and_ `/update-user`, so without that validator any string would persist and a visitor could self-assign an internal role. Internal roles are never selectable here. The sign-up and reset forms share `PasswordSchema` (`src/features/auth/schema/password.ts`): 8–128 characters with at least one number and one symbol. Better Auth of its own accord enforces only a length range, so a `hooks.before` middleware in `src/lib/auth.ts` re-applies the full schema to every endpoint that _sets_ a password (`/sign-up/email`, `/reset-password`, `/change-password`). `/sign-in/email` is deliberately excluded, so accounts whose password predates the policy can still sign in. Always available. Password hashes live in the `account.password` column. Sign-ups store the name supplied on the form (trimmed, 1-100 characters, enforced client-side) and are auto-signed-in (`requireEmailVerification` is off, so an unverified user can still sign in).
- **Email verification** — `emailVerification.sendOnSignUp` mails a link via the `VerificationEmail` template; Better Auth's own `/api/auth/verify-email` endpoint consumes it, so there is no app route for it.
- **Password reset** — `/reset-password` sends a link (1 hour expiry) via `ResetPasswordEmail`. Better Auth's callback bounces the emailed link off `/api/auth/reset-password/:token` and back to `/reset-password?token=…`, or `?error=INVALID_TOKEN` when it has expired. It does not create a session; the user signs in afterwards.

Rate limiting is configured at 20 requests per 60-second window using Better Auth's built-in `rateLimit` option.

## Styling

**Tailwind CSS v4** is integrated via `@tailwindcss/vite`. Theme switching is class-based on the `html` element through `next-themes`.

## Observability

### LogTape + Sentry

LogTape provides the app logger in `src/lib/logger.ts`. The server bootstrap (`instrument.server.mjs`) initialises Sentry with:

- `sendDefaultPii: false` — PII is not forwarded by default.
- `tracesSampleRate: 0.1` — 10% of server traces are sampled to control cost.

Enable `sendDefaultPii: true` and raise `tracesSampleRate` only intentionally, after reviewing your data-handling obligations.
