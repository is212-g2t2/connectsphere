# ConnectSphere

Event planning and venue booking for attendees, event organisers, event coordinators, venue staff, and technical support staff.

Built with TanStack Start, Better Auth, and Drizzle ORM.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.4.2 or later
- [Docker](https://www.docker.com/) for local services (Postgres, MinIO, Redis)

### Setup

1. **Install dependencies**

   ```bash
   bun install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Open `.env` and fill in the required values (see the [Environment Variables Reference](./docs/DEVELOPMENT.md#environment-variables) in the Development Guide).

3. **Start local services**

   ```bash
   docker compose up -d postgres redis minio minio_init
   ```

   This starts the infrastructure only. The `connectsphere` app service binds port 3000 and would clash with the local dev server — see the [Deployment Guide](./docs/DEPLOYMENT.md).

4. **Prepare the database**

   Apply migrations:

   ```bash
   bun run db:migrate
   ```

   _(Or push schema directly during local prototyping: `bun run db:push`)_

   Optionally seed with initial data:

   ```bash
   bun run db:seed
   ```

   This also creates three internal staff accounts that self-registration cannot
   produce (sign-up only allows external roles). They exist for building, testing
   and demonstrating the role-restricted stories:

   | Role                    | Email                         | Password        |
   | ----------------------- | ----------------------------- | --------------- |
   | Event Coordinator       | coordinator.seed@example.com  | `Seed-Pass123!` |
   | Venue Staff             | venue.staff.seed@example.com  | `Seed-Pass123!` |
   | Technical Support Staff | tech.support.seed@example.com | `Seed-Pass123!` |

   These credentials are non-production (shared password, `example.com`
   addresses, no real personal data) and must never be used outside local/demo environments.

   The same seed creates three demo venues (Harbour Hall, Seminar Room 2A, Rooftop Pavilion)
   with capacity, facilities, accessibility features, supported layouts and operating hours,
   plus two future periods of unavailability, so the venue stories have data to build against.
   Re-running `bun run db:seed` is safe: existing accounts and venues are left untouched.

5. **Start the dev server**

   ```bash
   bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Sign up, sign in, and land on the protected dashboard.

For complete workflow instructions, script catalogs, testing guidelines, and environment configuration, see the [Development Guide](./docs/DEVELOPMENT.md).

## Documentation

- [Development](./docs/DEVELOPMENT.md) — local setup, scripts catalog, database management, testing, and tooling.
- [Architecture](./docs/ARCHITECTURE.md) — project structure, data flow, auth, and observability.
- [Design System](./docs/DESIGN.md) — the ConnectSphere design system and its tokens.
- [Agents Guide](./AGENTS.md) — rules for coding agents working in this repo.
- [Deployment](./docs/DEPLOYMENT.md) — local Docker workflow, migrations, and hosting trade-offs.
- [Changelog](./docs/CHANGELOG.md) — version history.
- [Contributing](./docs/CONTRIBUTING.md) — branch, commit, and test conventions.
