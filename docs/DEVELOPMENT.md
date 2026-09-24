# Development Guide

This guide covers the local development environment, scripts catalog, database management, testing practices, and code quality tooling for this project.

## Prerequisites

- **[Bun](https://bun.sh/)** v1.4.2 or later
- **[Docker](https://www.docker.com/)** and Docker Compose (for local PostgreSQL, MinIO, and Redis, and Testcontainers)

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
   docker compose up -d postgres redis minio minio_init mailpit
   ```

   This provisions:
   - **PostgreSQL 18** on `localhost:5432` (`app` database, user/password: `postgres`/`postgres`)
   - **MinIO S3** on `localhost:9000` (API) and `localhost:9001` (web console: `admin` / `password`)
   - **MinIO Init** bucket provisioner (`app` bucket created automatically)
   - **Redis 7** on `localhost:6379`
   - **Mailpit** on `localhost:1025` (SMTP) and `localhost:8025` (web UI) for the E2E reset journey

   The `connectsphere` app container is deliberately excluded: it binds port 3000, and the E2E setup always starts its own production server on that port. See [Deployment](./DEPLOYMENT.md#the-normal-loop-services-in-docker-app-on-the-host) for the full stack.

4. **Prepare the database**:

   Run pending migrations to initialise tables:

   ```bash
   bun run db:migrate
   ```

   Optionally, seed sample records:

   ```bash
   bun run db:seed
   ```

   Seeded credentials and demo data are listed under [Seeded data](#seeded-data).

5. **Start the local development server**:

   ```bash
   bun run dev
   ```

   The application starts on [http://localhost:3000](http://localhost:3000).

## Seeded data

`bun run db:seed` creates three internal staff accounts that self-registration cannot produce (sign-up only allows external roles), for building, testing and demonstrating the role-restricted stories:

| Role                    | Email                         | Password        |
| ----------------------- | ----------------------------- | --------------- |
| Event Coordinator       | coordinator.seed@example.com  | `Seed-Pass123!` |
| Venue Staff             | venue.staff.seed@example.com  | `Seed-Pass123!` |
| Technical Support Staff | tech.support.seed@example.com | `Seed-Pass123!` |

The seeded attendee (`john.doe@example.com`) and organiser (`jane.doe@example.com`) also use `Seed-Pass123!`. The demo event request is connected to all five roles, so each access projection can be checked locally: jane owns it, the seeded Coordinator and Venue Staff are assigned to it, Technical Support holds an equipment request for it, and john is registered.

These credentials are non-production (shared password, `example.com` addresses, no real personal data) and must never be used outside local/demo environments.

The seed also creates three demo venues (Harbour Hall, Seminar Room 2A, Rooftop Pavilion) with capacity, facilities, accessibility features, supported layouts and operating hours, plus two future periods of unavailability. Re-running `bun run db:seed` is safe: existing accounts and venues are left untouched.

## Environment Variables

| Variable              | Required | Description                                                                                                                                              |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | ✅       | PostgreSQL connection string                                                                                                                             |
| `BETTER_AUTH_SECRET`  | ✅       | 32+ character secret for session signing                                                                                                                 |
| `BETTER_AUTH_URL`     | ✅       | App origin (default: `http://localhost:3000`)                                                                                                            |
| `SMOKE_TOKEN`         | Optional | Bearer token for `/api/smoke`; required in deployed environments, where the deploy workflow reads it from Secret Manager. Unset answers 401              |
| `SERVER_URL`          | Optional | Canonical public application URL                                                                                                                         |
| `RESEND_API_KEY`      | Optional | Required to send email. App boots without it; email calls throw a clear error                                                                            |
| `EMAIL_FROM`          | Optional | Sender address (default: `onboarding@resend.dev`)                                                                                                        |
| `SMTP_URL`            | Optional | SMTP relay for outgoing mail (`smtp://host:port`). Set, it sends over SMTP instead of Resend, which is how the E2E run captures reset emails via Mailpit |
| `MINIO_ENDPOINT`      | Optional | S3-compatible endpoint for file uploads. Accepts MinIO, AWS S3, Cloudflare R2, or Supabase Storage (`https://<project>.supabase.co/storage/v1/s3`)       |
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
| `bun run test:e2e`         | Run Playwright end-to-end tests (setup provisions database and app)    |
| `bun run codegen`          | Launch Playwright code generator for browser test recording            |
| `bun run prepare`          | Install Lefthook git pre-commit hooks                                  |

## Database Management & Migrations

The project uses [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`).

### Schema Locations

- `src/db/schema.ts`: Application domain schemas. Re-exports the auth tables; holds `eventRequests`, its handover history (`eventAssignments`) and clarifications (`clarificationRequests`), the venue catalogue (`venues`, `venueUnavailability`), the venue and equipment requests (`venueRequests`, `equipmentRequests`), and event registrations (`eventRegistrations`).
- `src/db/auth-schema.ts`: Better Auth schemas (`user` with `role`, `session`, `account`, `verification`).
- `src/db/drizzle/`: Generated SQL migration files and metadata.

### Migration Rules

- **Always generate migrations**: Whenever modifying schema files, generate a new SQL migration:
  ```bash
  bun run db:generate
  ```
- **Never handwrite SQL migrations**: Drizzle Kit maintains schema snapshots in `src/db/drizzle/meta/`. Handwritten migrations will cause snapshot drift. One reviewed exception: the booking exclusion constraint Drizzle cannot express ([ADR-5](./adrs/ADR-5-venue-booking-overlap.md)) is created with `db:generate --custom`; because the migrator runs all pending migrations in one transaction, its predicate calls an IMMUTABLE wrapper function rather than comparing the newly added enum label.
- **Commit schema and migrations together**: Always commit the schema modifications along with the resulting generated files in `src/db/drizzle/`.
- **Apply migrations**: Run `bun run db:migrate` to apply pending migrations.
- **Prototyping**: During early exploration, `bun run db:push` synchronises the schema directly without recording a migration file. Never use `db:push` in production.
- **Inspect data**: Run `bun run db:studio` to view and edit database rows via Drizzle Studio.

## Testing Guide

The test suite is structured into three tiers. Vitest coverage is enabled in `vitest.config.ts` (43% lines and statements, 29% branches, 24% functions over `src/env.ts`, `components`, `db`, `features`, `hooks` and `lib`, excluding `components/ui`, app bootstrap files, generated files and the migration folder), so unit and integration runs rewrite `coverage/`.

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

- Driven by Playwright (`playwright.config.ts`). `tests/e2e/global-setup.ts` owns the environment: it starts a `postgres:18-alpine` testcontainer on a random host port, applies the committed migrations, seeds it, then builds the app and starts the production server (`bun run build`, `bun run start`) on :3000 against that same `DATABASE_URL`. Teardown stops the server and the container, discarding the database.
- Docker must be running, and :3000 must be free: the setup fails instead of reusing another server, so the app and the specs always share one database.
- The reset-password journey sends mail through the capture server: run `docker compose up -d mailpit` and set `SMTP_URL="smtp://localhost:1025"` in `.env`. The upload journey reads MinIO from the same compose stack.

Run E2E tests:

```bash
bun run test:e2e
```

Run the same suite in Playwright's interactive UI (flags are forwarded):

```bash
bun run test:e2e --ui
```

### Running Targeted Tests

You can target specific test files or test names directly:

```bash
# Run a specific unit test file
bun run vitest run tests/unit/auth-session.test.ts

# Run a specific test case matching a pattern
bun run vitest run tests/unit/auth-session.test.ts -t "returns null"

# Run a specific E2E test file (Playwright receives the filter)
bun run test:e2e tests/e2e/landing.test.ts
```

## Code Quality & Git Hooks

### Linting & Formatting

- **[Oxlint](https://oxc.rs/docs/guide/usage/linter.html)**: Extremely fast linter. Checks are enforced with `--deny-warnings`, and the `@shadcn/lint` plugin rejects raw colors, arbitrary values, inline styles, unknown classes and restyling of shared primitives; its errors point to [`DESIGN.md`](./DESIGN.md).
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

## Project Conventions

Client/server bundle rules (module-level server imports, `.server.ts` suffixes, dynamic imports) live in `AGENTS.md` §Client/server boundary.

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
