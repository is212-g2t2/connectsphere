# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Where things are documented

Read these instead of re-deriving; do not duplicate their content here.

- `docs/ARCHITECTURE.md`: stack, directory map, data flow, auth flows, observability config.
- `docs/DEVELOPMENT.md`: local setup, environment variables, scripts, database workflows, testing, and tooling.
- `docs/CONTRIBUTING.md`: branch names, Conventional Commits, dependency and env-var rules.
- `README.md`: overview, quickstart, local services.

## Writing documentation

Each kind of content has exactly one home; decide it before writing:

- **What shipped**: `CHANGELOG.md` at the repo root, curated by the maintainer. Never add, edit, or remove a changelog entry, even for work that ships; acceptance detail stays in the PR.
- **Why a decision was made**: `docs/adrs/`.
- **How to do a procedure**: `docs/DEVELOPMENT.md`, `DEPLOYMENT.md`, `CONTRIBUTING.md`.
- **What is true about the system now**: `docs/ARCHITECTURE.md`.

`ARCHITECTURE.md` is undated: no ticket ids (`PTR-*`), no per-story narrative, no one-time release instructions ("apply migration 0011"). If a sentence only made sense in the release that introduced it, it belongs in the PR description, not in architecture. Anything architectural that must outlive a release goes in an ADR; a rule that already has a home gets a link, not a second copy.

Apply the [no-ai-slop](https://raw.githubusercontent.com/petergyang/no-ai-slop/refs/heads/main/skills/no-ai-slop/SKILL.md) rules when you write or edit docs: active voice, concrete facts over abstraction, no filler openers, no binary contrasts, em dashes only where they beat a comma or a full stop. Prose budget: a paragraph ≤ 4 lines, a list item ≤ 3 sentences. More than that wants a table, a list, or its own document, not a bigger paragraph.

## Running a single test

`package.json` only exposes whole-suite scripts; target a single test by passing the path through:

```bash
bun run vitest run tests/unit/auth-session.test.ts            # one file
bun run vitest run tests/unit/auth-session.test.ts -t "returns null"   # one case
bun run test:e2e tests/e2e/landing.test.ts            # one E2E file (forwards the filter)
```

## Verifying changes

Before calling work done: `bun run lint:check`, `bun run type:check` and `bun run format:check`, plus the suite your change touches (`test:unit`, `test:integration`, `test:e2e`). Full list: `docs/CONTRIBUTING.md` §Pre-PR Verification.

## Test layout gotchas

- `test:unit` runs the Vitest `unit` project (`vitest run --project unit`), targeting `tests/unit/` with `jsdom` environment.
- `test:integration` runs the Vitest `integration` project (`vitest run --project integration`), targeting `tests/integration/` with `node` environment.
- Unit tests must not start a database container; keep them to pure logic. Testcontainers belongs in integration/E2E only.
- Coverage is `enabled: true` in `vitest.config.ts`, so test runs rewrite `coverage/`.

## Client/server boundary

- Server functions exported via `createServerFn` and consumed by routes are compiled for the client environment. TanStack Start strips `.handler(...)` bodies but preserves all other `export` declarations.
- Never statically import runtime built-ins or server-only dependencies (`#/db`, **`#/db/schema`**, `"bun"`) at module level in a module the client can reach. The import alone is enough; it does not need an exported helper referencing it. Drizzle builds its tables by calling `pgTable()` at module scope, which a bundler cannot prove side-effect free, so the module is retained whole and Dead Code Elimination drops nothing. A `<feature>.server.ts` module (see below) is the sanctioned exception: nothing client-reachable may import it, so a static import there never reaches the bundle.
- `#/db/schema` is the trap, because unlike `#/db` it does **not** fail `bun run build`: it just silently serves the entire database schema, Better Auth tables included, to the browser. `tests/unit/client-bundle-safety.test.ts` walks every module under `src/features`, `src/hooks`, `src/lib` and `src/components` (modules are discovered, not listed) and is the only thing that catches it. When adding a server-only _dependency_, not a module, add its specifier to that test's `SERVER_ONLY_IMPORT`.
- Instead, reach server dependencies dynamically inside `.handler()` (or a middleware's `.server()` callback, as `src/features/auth/session.ts` does) via `await import("#/db")`, import server types with `import type`, and require injected dependencies in exported helpers (e.g. `database: Database`). Never anchor `database = db` as a default parameter on an exported function; the same test rejects that pattern and expects the caller to pass `database`.
- Do **not** give a client-reachable module the `<feature>.server.ts` suffix. `@tanstack/start-plugin-core`'s import-protection plugin denies `**/*.server.*` in the client environment, so the first route that imports it fails `bun run build`, and only `build`: `type:check` and the test suites stay green. That suffix is only for modules nothing client-reachable imports, like `event-requests/drafts.server.ts`.

## File layout & naming

- A page view is a feature component, not a route: `src/features/<feature>/components/<page>-page.tsx`, taking its route data (context, loader data, search) as props. The route file keeps only wiring (search validation, guards, loaders, metadata, pending/error components) and binds the two together with `component: () => <Page {...Route.use*()} />`. `tests/unit/route-module-boundaries.test.ts` fails if a route module declares anything but `Route` or reaches for React state.
- No `-model` suffix, and no entity-name stutter (`venues/venues-fns.ts`). A helper with only one caller lives in that caller's file, even if a unit test also imports and tests it; export it from the caller's file for the test. Only extract a helper into its own file when it has two or more application callers.

## Server functions

- Every `createServerFn` declares `.middleware([...])`. Session and permission enforcement runs there, never in the handler. `tests/unit/server-function-middleware.test.ts` fails the suite if one omits it, and `tests/integration/server-function-authorization.test.ts` proves a refusal runs before the handler.
- Validation lives in the Zod schema, parsed with `safeParse` rethrowing `issues[0].message`. Never let a raw `ZodError` reach a route.

## Imports

`#/...` is the only alias for `src/`. It lives in three places that must stay in sync (`tsconfig.json` `paths`, `package.json` `imports`, and `vitest.config.ts` `alias`), so a new alias means touching all three or it will typecheck and then fail under test. `components.json` already generates `#/`, so shadcn output needs no rewriting. Workflow: `docs/DEVELOPMENT.md` §Imports & Path Aliases.

## Adding an environment variable

Three places, all required: `src/env.ts` (optional unless the app cannot boot without it), a commented entry in `.env.example`, and `README.md` if it changes setup steps. Workflow: `docs/DEVELOPMENT.md` §Adding Environment Variables.

## Database schemas and migrations

When touching any schema file (`src/db/schema.ts`, `src/db/auth-schema.ts`): run `bun run db:generate`, review the generated DDL in `src/db/drizzle/`, and commit the schema with its migration together. Never handwrite SQL, and never use `db:push` outside local prototyping; it records no migration history. Workflow: `docs/DEVELOPMENT.md` §Migration Rules.
