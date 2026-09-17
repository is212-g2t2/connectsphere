# Development Guide

This guide covers the local development environment, scripts catalog, database management, testing practices, and code quality tooling for this project.

## Prerequisites

- **[Bun](https://bun.sh/)** v1.4.2 or later
- **[Docker](https://www.docker.com/)** and Docker Compose (for local PostgreSQL, MinIO, and Redis)

## Local Setup

1. **Clone the repository and install dependencies**:

   ```bash
   bun install
   ```

2. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

   Inspect `.env` and fill in any optional credentials needed for your feature work (e.g. `RESEND_API_KEY`). Defaults for local services work out of the box.

3. **Start local infrastructure services**:

   ```bash
   docker compose up -d postgres redis minio minio_init
   ```

   This provisions:
   - **PostgreSQL 18** on `localhost:5432` (`app` database, user/password: `postgres`/`postgres`)
   - **MinIO S3** on `localhost:9000` (API) and `localhost:9001` (web console: `admin` / `password`)
   - **MinIO Init** bucket provisioner (`app` bucket created automatically)
   - **Redis 7** on `localhost:6379`

   The `connectsphere` app container is deliberately excluded: it binds port 3000, and Playwright's `reuseExistingServer` would attach to it instead of your dev server. See [Deployment](./DEPLOYMENT.md#the-normal-loop-services-in-docker-app-on-the-host) for the full stack.

4. **Prepare the database**:

   Run pending migrations to initialise tables:

   ```bash
   bun run db:migrate
   ```

   Optionally, seed sample records:

   ```bash
   bun run db:seed
   ```

5. **Start the local development server**:

   ```bash
   bun run dev
   ```

   The application starts on [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

| Variable              | Required | Description                                                                                                                                              |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | ✅       | PostgreSQL connection string                                                                                                                             |
| `BETTER_AUTH_SECRET`  | ✅       | 32+ character secret for session signing                                                                                                                 |
| `BETTER_AUTH_URL`     | ✅       | App origin (default: `http://localhost:3000`)                                                                                                            |
| `SMOKE_TOKEN`         | Optional | Bearer token for `/api/smoke`; required in deployed environments, where `release.yml` reads it from Secret Manager. Unset answers 401                    |
| `SERVER_URL`          | Optional | Canonical public application URL                                                                                                                         |
| `RESEND_API_KEY`      | Optional | Required to send email. App boots without it; email calls throw a clear error                                                                            |
| `EMAIL_FROM`          | Optional | Sender address (default: `onboarding@resend.dev`)                                                                                                        |
| `MINIO_ENDPOINT`      | Optional | S3-compatible endpoint — enables file uploads. Accepts MinIO, AWS S3, Cloudflare R2, or Supabase Storage (`https://<project>.supabase.co/storage/v1/s3`) |
| `MINIO_BUCKET`        | Optional | Bucket name (default: `app`)                                                                                                                             |
| `MINIO_ACCESS_KEY`    | Optional | Storage access key (default: `admin`)                                                                                                                    |
| `MINIO_SECRET_KEY`    | Optional | Storage secret key (default: `password`)                                                                                                                 |
| `REDIS_URL`           | Optional | Redis connection string for `src/lib/redis.server.ts` (Bun-native client); nothing imports that module yet, so setting it currently has no effect        |
| `SENTRY_AUTH_TOKEN`   | Optional | Auth token for Sentry source map uploads at build time                                                                                                   |
| `SENTRY_ENVIRONMENT`  | Optional | Sentry environment tag for the server SDK, read by `instrument.server.mjs` (default: `development`; Terraform sets `production`/`staging` when deployed) |
| `VITE_APP_TITLE`      | Optional | Application title displayed in UI branding                                                                                                               |
| `VITE_SENTRY_DSN`     | Optional | Enables Sentry error tracking                                                                                                                            |
| `VITE_SENTRY_ORG`     | Optional | Sentry organization slug                                                                                                                                 |
| `VITE_SENTRY_PROJECT` | Optional | Sentry project slug                                                                                                                                      |

---

## Scripts Catalog

All available scripts defined in `package.json`:

| Command                    | Description                                                            |
| -------------------------- | ---------------------------------------------------------------------- |
| `bun run dev`              | Start development server with SSR instrumentation on port 3000         |
| `bun run build`            | Build the application for production using Nitro and Vite              |
| `bun run build:docker`     | Build production Docker container image                                |
| `bun run preview`          | Preview production build locally                                       |
| `bun run start`            | Run production build server with Nitro and server instrumentation      |
| `bun run clean`            | Remove build artifacts, caches, coverage, and generated route trees    |
| `bun run type:check`       | Run TypeScript compiler check without emitting output (`tsc --noEmit`) |
| `bun run lint:check`       | Check code with Oxlint (denying warnings)                              |
| `bun run lint:fix`         | Automatically fix lint issues with Oxlint                              |
| `bun run format:check`     | Check code and doc formatting with Oxfmt                               |
| `bun run format:fix`       | Format files with Oxfmt                                                |
| `bun run auth:generate`    | Generate Better Auth schema components                                 |
| `bun run db:generate`      | Generate Drizzle SQL migration files from schema definitions           |
| `bun run db:migrate`       | Execute pending Drizzle migrations against `DATABASE_URL`              |
| `bun run db:push`          | Push schema directly to database (rapid prototyping only)              |
| `bun run db:pull`          | Introspect database schema into Drizzle definitions                    |
| `bun run db:seed`          | Run database seeding script (`scripts/seed.ts`)                        |
| `bun run db:studio`        | Launch Drizzle Studio web interface                                    |
| `bun run test`             | Run all Vitest test suites across projects                             |
| `bun run test:unit`        | Run unit tests (`tests/unit/`, `jsdom` environment)                    |
| `bun run test:integration` | Run integration tests (`tests/integration/`, `node` environment)       |
| `bun run test:e2e`         | Run Playwright end-to-end tests                                        |
| `bun run codegen`          | Launch Playwright code generator for browser test recording            |
| `bun run prepare`          | Install Lefthook git pre-commit hooks                                  |

---

## Database Management & Migrations

The project uses [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`).

### Schema Locations

- `src/db/schema.ts` — Application domain schemas. Re-exports the auth tables; holds `eventRequests` (PTR-9, PTR-10, PTR-11, PTR-13), Coordinator handover history (`eventAssignments`, PTR-16), and the venue catalogue (`venues`, `venue_unavailability`, PTR-26). The equipment tables arrive with the stories that build them.
- `src/db/auth-schema.ts` — Better Auth schemas (`user` with `role`, `session`, `account`, `verification`).
- `src/db/drizzle/` — Generated SQL migration files and metadata.

### Migration Rules

- **Always generate migrations**: Whenever modifying schema files, generate a new SQL migration:
  ```bash
  bun run db:generate
  ```
- **Never handwrite SQL migrations**: Drizzle Kit maintains schema snapshots in `src/db/drizzle/meta/`. Handwritten migrations will cause snapshot drift.
- **Commit schema and migrations together**: Always commit the schema modifications along with the resulting generated files in `src/db/drizzle/`.
- **Apply migrations**: Run `bun run db:migrate` to apply pending migrations.
- **Prototyping**: During early exploration, `bun run db:push` synchronises the schema directly without recording a migration file. Never use `db:push` in production.
- **Inspect data**: Run `bun run db:studio` to view and edit database rows via Drizzle Studio.

---

## Testing Guide

The test suite is structured into three tiers:

### 1. Unit Tests (`tests/unit/`)

- Configured under the `unit` project in `vitest.config.ts`.
- Uses `jsdom` environment with `@testing-library/react`.
- **Rule**: Unit tests must test pure logic and isolated components. They **must not** start a database container or rely on external network services.

Run unit tests:

```bash
bun run test:unit
```

### 2. Integration Tests (`tests/integration/`)

- Configured under the `integration` project in `vitest.config.ts`.
- Uses `node` environment.
- Tests database queries and service interactions using Testcontainers (`@testcontainers/postgresql`).

Run integration tests:

```bash
bun run test:integration
```

### 3. End-to-End Tests (`tests/e2e/`)

- Driven by Playwright (`playwright.config.ts`).
- Tests full browser rendering, authentication flows, route guards, and UI interactions.

Run E2E tests:

```bash
bun run test:e2e
```

Run Playwright in interactive UI mode:

```bash
bunx playwright test --ui
```

### Running Targeted Tests

You can target specific test files or test names directly:

```bash
# Run a specific unit test file
bun run vitest run tests/unit/auth-session.test.ts

# Run a specific test case matching a pattern
bun run vitest run tests/unit/auth-session.test.ts -t "returns null"

# Run a specific E2E test file
bun run playwright test tests/e2e/landing.test.ts
```

---

## Venue availability (PTR-28)

Event Coordinators, Venue Staff and Technical Support Staff open `/venues/availability` from the dashboard and see a venue's free, confirmed and blocked periods for an inclusive date range. Access is read-only and gated by the existing `venue:read` function; an external role is redirected to `/dashboard` and refused by the server function (criterion 5).

The page is a feature view (`src/features/venues/components/venue-calendar-page.tsx`) wired by the route's search parameters and loader: submitting the form navigates with `venueId`, `startDate` and `endDate`, the loader calls `getVenueAvailability`, and `src/features/venues/records.server.ts` reads `venues` and `venue_unavailability`. `src/features/venues/availability.ts` holds the pure half — floating timestamps, opening periods and the projection that subtracts recorded occupancy from the venue's opening hours.

Timestamps stay floating venue-local wall-clock strings end to end: Postgres `timestamp without time zone` values are compared as fixed-width strings and never parsed with `Date`, appended with `Z`, or resolved against the server or browser timezone. Operating hours are `HH:MM` ranges per weekday, `null` on a closed day.

AC3 is mocked: booking persistence arrives with PTR-31/PTR-33, so the live read passes `bookings: []` and reports recorded unavailability only. The projection already renders an approved booking as a confirmed period, and `tests/unit/venue-availability.test.ts` pins that; the live E2E run covers AC1, AC2, AC4 and AC5.

Playwright global setup reuses a reachable `DATABASE_URL` or starts a PostgreSQL testcontainer, runs migrations for a container it starts, and runs the idempotent shared seed once before the workers. When Docker is unavailable, provide a reachable, already-migrated `DATABASE_URL`.

---

## Code Quality & Git Hooks

### Linting & Formatting

- **[Oxlint](https://oxc.rs/docs/guide/usage/linter.html)**: Extremely fast linter. Checks are enforced with `--deny-warnings`.
  ```bash
  bun run lint:check
  bun run lint:fix
  ```
- **[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)**: Fast code and markdown formatter.
  ```bash
  bun run format:check
  bun run format:fix
  ```
- **TypeScript**:
  ```bash
  bun run type:check
  ```

### Pre-commit Hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs automatically on `git commit`. It executes `oxlint --fix` and `oxfmt --write` against staged files:

```bash
bun run prepare # reinstalls hooks if needed
```

---

## Architecture & Code Conventions

### Server Functions & Bundle Isolation

Server functions created with `createServerFn` (TanStack Start) are imported by client routes. TanStack Start strips the `.handler(...)` bodies from client builds, but preserves all other code in the module. The same applies to `createMiddleware().server(...)` bodies — an auth middleware is client-safe to import because its `.server()` callback is stripped, while anything a server function module statically imports is not.

- **Avoid module-level server imports**: Never statically import server-only dependencies (`#/db`, `#/db/schema`, `"bun"`) at the top level in a module a client route can reach — the import alone is enough, even with no exported helper referencing it. Drizzle builds its tables with `pgTable()` at module scope, so a bundler cannot prove the module side-effect free and retains it whole. `tests/unit/client-bundle-safety.test.ts` catches imports like `#/db/schema` that do not fail `bun run build`.
- **Use dynamic imports inside handlers**:
  ```ts
  const { db } = await import("#/db");
  ```
- **Import server types with `import type`**:
  ```ts
  import type { Database } from "#/db";
  ```
- **Do not use `.server.ts` naming for route-imported files**: `@tanstack/start-plugin-core` blocks files matching `**/*.server.*` from the client environment. The `.server.ts` suffix is reserved only for modules never imported by client routes.

### Imports & Path Aliases

`#/*` is the sole alias for `src/*`. It is configured synchronously across:

- `tsconfig.json` (`paths`)
- `package.json` (`imports`)
- `vitest.config.ts` (`alias`)

Do not introduce alternate aliases without updating all three configuration files.

### Adding Environment Variables

When adding a new environment variable:

1. Declare and validate it in `src/env.ts` using `@t3-oss/env-core`. Keep it optional unless strictly required for bootstrap.
2. Add a commented entry with description and defaults in `.env.example`.
3. If it changes setup or prerequisites, document it in `README.md` and this guide.
