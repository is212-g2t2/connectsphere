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

   This starts the infrastructure only. The `connectsphere` app service binds port 3000 and would clash with the local dev server; see the [Deployment Guide](./docs/DEPLOYMENT.md).

4. **Prepare the database**

   ```bash
   bun run db:migrate   # apply migrations
   bun run db:seed      # optional: demo accounts and venues
   ```

   _(Or push schema directly during local prototyping: `bun run db:push`.)_

   Seeded credentials and demo data are listed in the [Development Guide](./docs/DEVELOPMENT.md#seeded-data).

5. **Start the dev server**

   ```bash
   bun run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Sign up, sign in, and land on the protected dashboard.

For complete workflow instructions, script catalogs, testing guidelines, and environment configuration, see the [Development Guide](./docs/DEVELOPMENT.md).

## Documentation

- [Development](./docs/DEVELOPMENT.md): local setup, scripts catalog, database management, testing, and tooling.
- [Architecture](./docs/ARCHITECTURE.md): project structure, data flow, auth, and observability.
- [Design System](./docs/DESIGN.md): the ConnectSphere design system and its tokens.
- [Agents Guide](./AGENTS.md): rules for coding agents working in this repo.
- [Deployment](./docs/DEPLOYMENT.md): deployed environments, the release pipeline, rollback, and the local Docker workflow.
- [Changelog](./CHANGELOG.md): version history.
- [Contributing](./docs/CONTRIBUTING.md): branch, commit, and test conventions.
