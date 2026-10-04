# Contributing

## Local Development

Before you open a pull request, make sure that your local environment is configured and operates correctly. The [Development Guide](./DEVELOPMENT.md) gives the prerequisites, the local service orchestration (Docker Compose), and the complete scripts catalogue. Follow its instructions.

## Branches

- Start feature work from `main`. Open pull requests against `main`. A merge to `main` starts the staging deploy.
- Production deploys only after you publish a release. release-please maintains the version PR that creates the release. See the [Deployment Guide](./DEPLOYMENT.md#releases).
- Use short, lowercase, hyphen-separated names: `feat/venue-booking`, `fix/auth-redirect`, `chore/ci-cache`.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add venue booking to the coordinator workspace
fix: redirect signed-in users away from /login
chore: pin Bun version in CI
```

## Pre-PR Verification

Run the full verification suite before you open a PR:

```bash
bun run lint:check
bun run type:check
bun run format:check
bun run test:unit
bun run test:integration
bun run test:e2e
```

New features must have one or more unit tests that cover the core behaviour. New routes must have one or more Playwright smoke tests that verify the happy path and the redirect guards. For the test tier rules and the commands for targeted tests, see the [Testing Guide in DEVELOPMENT.md](./DEVELOPMENT.md#testing-guide).

## Database changes

Commit schema changes (`src/db/schema.ts`, `src/db/auth-schema.ts`) with their generated migration in `src/db/drizzle/`. The migration must apply cleanly against your local database. Never handwrite migrations. One reviewed exception is the booking exclusion constraint Drizzle cannot express, added with `db:generate --custom` ([ADR-5](./adrs/ADR-5-venue-booking-overlap.md)).

A code-quality job regenerates migrations and fails if `src/db/drizzle/` differs. The same job runs `drizzle-kit check` for conflicting or broken migration files. Regenerate after the last schema change.

Full workflow: [Database Management in DEVELOPMENT.md](./DEVELOPMENT.md#database-management-and-migrations).

## Adding dependencies

Every runtime dependency in `package.json` must be used by shipped code. Dev dependencies are permitted if they do not enter the production bundle.

## Environment variables

Add new variables in three places. Declare them in `src/env.ts`, comment them in `.env.example`, and mention them in `README.md` when they change the setup. See [DEVELOPMENT.md §Adding Environment Variables](./DEVELOPMENT.md#adding-environment-variables).
