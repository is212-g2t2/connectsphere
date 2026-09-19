# Contributing

## Local Development

Before opening a pull request, ensure your local environment is configured and working. Follow the instructions in the [Development Guide](./DEVELOPMENT.md) for prerequisites, local service orchestration (Docker Compose), and the complete scripts catalog.

## Branches

- Base feature work off `staging` and open pull requests against `staging`. Merging a code change to `staging` deploys staging.
- `staging` → `main` is **fast-forward only**. Merging to `main` deploys production. A squash or rebase rewrites the commit SHA, so the release pipeline rebuilds instead of shipping the image staging already tested; see the [Deployment Guide](./DEPLOYMENT.md#releases).
- Use short, lowercase, hyphen-separated names: `feat/venue-booking`, `fix/auth-redirect`, `chore/ci-cache`.

## Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add venue booking to the coordinator workspace
fix: redirect signed-in users away from /login
chore: pin Bun version in CI
```

## Pre-PR Verification

Run the full verification suite before opening a PR:

```bash
bun run lint:check
bun run type:check
bun run format:check
bun run test:unit
bun run test:integration
bun run test:e2e
```

New features need at least one unit test covering the core behaviour. New routes need at least one Playwright smoke test verifying the happy path and any redirect guards. For detailed test tier rules and running targeted tests, see the [Testing Guide in DEVELOPMENT.md](./DEVELOPMENT.md#testing-guide).

## Database changes

Schema changes (`src/db/schema.ts`, `src/db/auth-schema.ts`) ship in the same commit as their generated migration in `src/db/drizzle/`, and the migration must apply cleanly against your local database. Never handwrite migrations. A code-quality job regenerates migrations and fails if `src/db/drizzle/` differs, and runs `drizzle-kit check` for conflicting or broken migration files, so regenerate after the last schema edit. Full workflow: [Database Management in DEVELOPMENT.md](./DEVELOPMENT.md#database-management--migrations).

## Adding dependencies

Every runtime dependency added to `package.json` must be used by shipped code. Dev dependencies are fine as long as they stay out of the production bundle.

## Environment variables

New variables follow [DEVELOPMENT.md §Adding Environment Variables](./DEVELOPMENT.md#adding-environment-variables): declared in `src/env.ts`, commented in `.env.example`, and mentioned in `README.md` when they change setup.
