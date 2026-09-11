# ConnectSphere

Event planning and venue booking attendees, event organisers, event coordinators, venue staff, and technical support staff.

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
   docker compose up -d
   ```

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
- [Changelog](./docs/CHANGELOG.md) — version history.
- [Contributing](./docs/CONTRIBUTING.md) — branch, commit, and test conventions.
