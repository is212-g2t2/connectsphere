# Development Guide

This guide covers the local development environment, the scripts catalogue, database management, testing, and code quality tooling for the project.

## Prerequisites

- **[Bun](https://bun.sh/)** v1.4.3 or later
- **[Docker](https://www.docker.com/)** and Docker Compose (for local PostgreSQL and Redis, and for Testcontainers)

## Local Setup

1. **Clone the repository and install dependencies**:

   ```bash
   bun install
   ```

2. **Configure the environment variables**:

   ```bash
   cp .env.example .env
   ```

   Inspect `.env` and fill in the optional credentials that your feature work needs, for example `RESEND_API_KEY`. The defaults for the local services work with no extra configuration.

3. **Start the local infrastructure services**:

   ```bash
   docker compose up -d postgres redis mailpit
   ```

   This command provisions:

   - **PostgreSQL 18** on `localhost:5432` (database `app`, user/password: `postgres`/`postgres`)
   - **Redis 7** on `localhost:6379`
   - **Mailpit** on `localhost:1025` (SMTP) and `localhost:8025` (web UI) for the E2E reset journey

   The command deliberately excludes the `connectsphere` application container. It binds port 3000, and the E2E setup always starts its own production server on that port. See [Deployment](./DEPLOYMENT.md#the-normal-loop-services-in-docker-the-application-on-the-host) for the full stack.

4. **Prepare the database**:

   Run the pending migrations to initialize the tables:

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

`bun run db:seed` creates seven internal staff accounts that self-registration cannot produce, because sign-up allows only external roles. These accounts exist to build, test, and demonstrate the role-restricted stories:

| Role                    | Email                           | Password     |
| ----------------------- | ------------------------------- | ------------ |
| Event Coordinator       | coordinator.seed@example.com    | `password1!` |
| Event Coordinator       | coordinator2.seed@example.com   | `password1!` |
| Event Coordinator Lead  | lead.seed@example.com           | `password1!` |
| Event Coordinator Lead  | lead2.seed@example.com          | `password1!` |
| Venue Staff             | venue.staff.seed@example.com    | `password1!` |
| Technical Support Staff | tech.support.seed@example.com   | `password1!` |
| Safety Officer          | safety.officer.seed@example.com | `password1!` |

The seeded attendee (`john.doe@example.com`) and organiser (`jane.doe@example.com`) also use `password1!`. The demo event request reaches the attendee, organiser, coordinator, lead, venue staff, and technical support projections. It belongs to jane. The seeded Coordinator and Venue Staff are assigned to it. Technical Support holds an equipment request for it, and john is registered. The Safety Officer projection needs a review row, which PTR-148's sweep raises; the seed only creates the account.

A second event, ConnectSphere Open Day, is confirmed with registration on, so attendees can open its event page.

These credentials are not for production (shared password, `example.com` addresses, no real personal data). Never use them outside local or demo environments.

The seed also creates fifty venues (Harbour Hall, Seminar Room 2A, Rooftop Pavilion, plus forty-seven extra rooms and halls). Each venue has capacity, facilities, accessibility features, supported layouts, and operating hours. The seed records five future venue blocks (periods of unavailability).

A re-run of `bun run db:seed` is safe: it leaves existing accounts and venues untouched.

For venue blocks, a re-run lifts the live blocks that the seed recorded, then records them again with their ledger rows. A block with no creator and no ledger row counts as a seed block, because it comes from before blocks stored their creator. Lifted blocks stay as history. The seed skips a block that another live block overlaps.

The fictional equipment inventory contains ten types, including Portable Projectors, Wireless Microphones, Portable PA Systems, Folding Chairs, and LED Uplighters. The seed marks small unavailable quantities for maintenance, so stock stays available before reservations. A re-run of the seed does not duplicate equipment types or unavailable units.

The seed also creates one hundred extra people (fifty attendees, fifty organisers) and twenty extra events (sixteen confirmed with registration on, four submitted), each with a venue booking, an equipment line, and registrations on the confirmed ones.

## Environment Variables

| Variable                    | Required | Description                                                                                                                                                                        |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | ✅       | PostgreSQL connection string                                                                                                                                                       |
| `BETTER_AUTH_SECRET`        | ✅       | 32+ character secret for session signing                                                                                                                                           |
| `BETTER_AUTH_URL`           | ✅       | Application origin (default: `http://localhost:3000`)                                                                                                                              |
| `SMOKE_TOKEN`               | Optional | Bearer token for `/api/smoke`. Required in deployed environments, where the deploy workflow reads it from Secret Manager. An unset token answers 401                               |
| `CRON_TOKEN`                | Optional | Bearer token for `/api/cron/notifications`, the notification email worker (PTR-55). An unset token answers 401. Cloud Scheduler supplies the token when deployed                   |
| `SERVER_URL`                | Optional | Canonical public application URL                                                                                                                                                   |
| `RESEND_API_KEY`            | Optional | Required to send email. The application boots without it, and email calls throw a clear error                                                                                      |
| `EMAIL_FROM`                | Optional | Sender address (default: `onboarding@resend.dev`)                                                                                                                                  |
| `SMTP_URL`                  | Optional | SMTP relay for outgoing mail (`smtp://host:port`). When set, the application sends over SMTP instead of Resend. The E2E run uses this path to capture reset emails through Mailpit |
| `REDIS_URL`                 | Optional | Redis connection string for `src/lib/redis.server.ts` (Bun-native client). Nothing imports that module yet, so the value has no effect today                                       |
| `STORAGE_BUCKET`            | Optional | Private bucket for draft supporting documents. Unset means attaching is unavailable while all else works                                                                           |
| `STORAGE_ENDPOINT`          | Optional | S3-compatible endpoint (MinIO locally). Defaults to the provider endpoint when unset                                                                                               |
| `STORAGE_REGION`            | Optional | Object storage region                                                                                                                                                              |
| `STORAGE_ACCESS_KEY_ID`     | Optional | GCS S3-interop HMAC access id for draft supporting documents                                                                                                                       |
| `STORAGE_SECRET_ACCESS_KEY` | Optional | GCS S3-interop HMAC secret for draft supporting documents                                                                                                                          |
| `SENTRY_AUTH_TOKEN`         | Optional | Token for Sentry source map uploads at build time                                                                                                                                  |
| `SENTRY_ENVIRONMENT`        | Optional | Sentry environment tag for the server SDK, read by `instrument.server.mjs`. Default: `development`. Terraform sets `production` or `staging` when deployed                         |
| `VITE_APP_TITLE`            | Optional | Application title displayed in UI branding                                                                                                                                         |
| `VITE_SENTRY_DSN`           | Optional | Enables Sentry error tracking                                                                                                                                                      |
| `VITE_SENTRY_ORG`           | Optional | Sentry organization slug                                                                                                                                                           |
| `VITE_SENTRY_PROJECT`       | Optional | Sentry project slug                                                                                                                                                                |

## Scripts Catalogue

The scripts that `package.json` defines:

| Command                    | Description                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `bun run dev`              | Start the development server with SSR instrumentation on port 3000                          |
| `bun run build`            | Build the application for production with Nitro and Vite                                    |
| `bun run build:docker`     | Build the production Docker container image                                                 |
| `bun run preview`          | Preview the production build locally                                                        |
| `bun run start`            | Run the production build server with Nitro and server instrumentation                       |
| `bun run clean`            | Remove build artifacts, caches, coverage, and generated route trees                         |
| `bun run type:check`       | Run Bun's native type checker (`bun check`)                                                 |
| `bun run lint:check`       | Check code with Oxlint (denies warnings)                                                    |
| `bun run lint:fix`         | Automatically fix lint issues with Oxlint                                                   |
| `bun run format:check`     | Check code and doc formatting with Oxfmt                                                    |
| `bun run format:fix`       | Format files with Oxfmt                                                                     |
| `bun run auth:generate`    | Generate Better Auth schema components                                                      |
| `bun run db:generate`      | Generate Drizzle SQL migration files from schema definitions                                |
| `bun run db:migrate`       | Apply pending Drizzle migrations to the database in `DATABASE_URL`                          |
| `bun run db:push`          | Push the schema directly to the database (rapid prototyping only)                           |
| `bun run db:pull`          | Introspect the database schema into Drizzle definitions                                     |
| `bun run db:seed`          | Run the database seed script (`scripts/seed.ts`)                                            |
| `bun run db:studio`        | Start the Drizzle Studio web interface                                                      |
| `bun run test`             | Run all Vitest test suites across projects                                                  |
| `bun run test:unit`        | Run unit tests (`tests/unit/`, `node` default; component tests opt into `jsdom`)            |
| `bun run test:integration` | Run integration tests (`tests/integration/`, `node` environment)                            |
| `bun run test:e2e`         | Run the Playwright end-to-end tests (the setup provisions the database and the application) |
| `bun run codegen`          | Start the Playwright code generator for browser test recording                              |
| `bun run prepare`          | Install the Lefthook git pre-commit hooks                                                   |

## Database Management and Migrations

The project uses [Drizzle ORM](https://orm.drizzle.team/) with Bun's native SQL driver (`bun:sql` / `drizzle-orm/bun-sql`).

### Schema Locations

- `src/db/schema.ts`: application domain schemas. The module re-exports the authentication tables, and it holds `eventRequests`, its assignment history (`eventAssignments`), retired handover records (`eventHandovers`), and clarifications (`clarificationRequests`). It also holds the venue catalogue (`venues`, `venueUnavailability`), the venue and equipment requests (`venueRequests`, `equipmentRequests`), the venue occupancy ledger (`venueOccupancy`), the equipment catalogue (`equipmentTypes`, `equipmentUnavailability`, `equipmentReservations`), and event registrations (`eventRegistrations`).
- `src/db/auth-schema.ts`: Better Auth tables (`user` with `role`, `session`, `account`, `verification`).
- `src/db/drizzle/`: generated SQL migration files and metadata.

### Migration Rules

- **Always generate migrations**: when you change a schema file, generate a new SQL migration:
  ```bash
  bun run db:generate
  ```
- **Never handwrite SQL migrations**: Drizzle Kit maintains schema snapshots in `src/db/drizzle/meta/`, and handwritten migrations cause snapshot drift. One reviewed exception is the venue occupancy exclusion constraint that Drizzle cannot express, created with `db:generate --custom` ([ADR-7](./adrs/ADR-7-venue-occupancy-ledger.md)).
- **Commit schema and migrations together**: always commit the schema changes with the generated files in `src/db/drizzle/`.
- **Apply migrations**: run `bun run db:migrate` to apply the pending migrations.
- **Prototyping**: during early exploration, `bun run db:push` synchronizes the schema directly without a migration file. Never use `db:push` in production.
- **Inspect data**: run `bun run db:studio` to view and edit database rows through Drizzle Studio.

## Testing Guide

The test suite has three tiers. Vitest collects coverage only when `COVERAGE=1`: 43% lines and statements, 29% branches, and 24% functions over `src/env.ts`, `components`, `db`, `features`, `hooks`, and `lib`. The configuration excludes `components/ui`, the application bootstrap files, generated files, and the migration directory. The unit CI job sets `COVERAGE=1` and enforces these gates. A local run rewrites `coverage/` only when you set the variable.

### 1. Unit Tests (`tests/unit/`)

- Configured under the `unit` project in `vitest.config.ts`.
- Uses the `node` environment by default. Component tests opt into `jsdom` with a per-file pragma and use `@testing-library/react`.
- **Rule**: unit tests must test pure logic and isolated components. They **must not** start a database container or rely on external network services.

Run unit tests:

```bash
bun run test:unit
```

### 2. Integration Tests (`tests/integration/`)

- Configured under the `integration` project in `vitest.config.ts`.
- Uses the `node` environment.
- Tests database queries and service interactions with Testcontainers (`@testcontainers/postgresql`).

Run integration tests:

```bash
bun run test:integration
```

### 3. End-to-End Tests (`tests/e2e/`)

- Playwright drives these tests (`playwright.config.ts`). `tests/e2e/global-setup.ts` owns the environment. By default it starts a `postgres:18-alpine` testcontainer on a random host port, applies the committed migrations, and seeds the database. It then builds the application and starts the production server (`bun run build`, `bun run start`) on :3000 against that same `DATABASE_URL`. Teardown stops the server and the container, and it discards the database.
- Docker must be running, and :3000 must be free, unless you reuse a running server. With `E2E_SKIP_BUILD=1`, the setup skips the build and the container and runs the tests against the server already on :3000. Set `DATABASE_URL` to that server's database, or the tests write a different database than the server reads. Reused runs also inherit rows from earlier runs, so use a fresh server for clean results. The application and the tests therefore always share one database.
- The reset-password journey sends mail through the capture server. Run `docker compose up -d mailpit` and set `SMTP_URL="smtp://localhost:1025"` in `.env`.
- Notification emails wait in the `notifications` table. The application does not send them inline, and nothing schedules the worker locally. Only sign-up verification and password reset send immediately.

  Drain the queue when you want the mail to arrive. Mailpit shows the mail when `SMTP_URL` is set:

  ```bash
  curl -fsS -X POST -H "Authorization: Bearer $CRON_TOKEN" http://localhost:3000/api/cron/notifications
  ```

  E2E drains the queue automatically before it waits on Mailpit, and it uses `e2e-cron-token` as the default `CRON_TOKEN` when the environment sets no value.

Run E2E tests:

```bash
bun run test:e2e
```

Run the same suite in the Playwright interactive UI (flags are forwarded):

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

## Code Quality and Git Hooks

### Linting and Formatting

- **[Oxlint](https://oxc.rs/docs/guide/usage/linter.html)**: a fast linter. Checks run with `--deny-warnings`, and the `@shadcn/lint` plugin rejects raw colors, arbitrary values, inline styles, unknown classes, and restyling of shared primitives. Its errors point to [`DESIGN.md`](./DESIGN.md).
  ```bash
  bun run lint:check
  bun run lint:fix
  ```
- **[Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)**: a fast code and markdown formatter.
  ```bash
  bun run format:check
  bun run format:fix
  ```
- **TypeScript**:
  ```bash
  bun run type:check
  ```

### Pre-commit Hooks

[Lefthook](https://github.com/evilmartians/lefthook) runs automatically on `git commit`. It runs `oxlint --fix` and `oxfmt --write` against staged files:

```bash
bun run prepare # reinstalls hooks if needed
```

## Project Conventions

The client/server bundle rules (module-level server imports, `.server.ts` suffixes, and dynamic imports) are in `AGENTS.md` §Client/server boundary.

### Imports and Path Aliases

`#/*` is the sole alias for `src/*`. The alias lives in three places that must stay in sync:

- `tsconfig.json` (`paths`)
- `package.json` (`imports`)
- `vitest.config.ts` (`alias`)

Do not add another alias without updating all three configuration files.

### Adding Environment Variables

When you add a new environment variable:

1. Declare and validate the variable in `src/env.ts` with `@t3-oss/env-core`. Keep it optional unless the application cannot boot without it.
2. Add a commented entry with a description and the default in `.env.example`.
3. If the variable changes the setup or the prerequisites, document it in `README.md` and in this guide.
