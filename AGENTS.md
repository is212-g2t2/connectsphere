# AGENTS.md

This file gives guidance to AI agents that work with code in this repository.

## Where things are documented

Read these documents. Do not derive the information again. Do not copy their content here.

- `docs/ARCHITECTURE.md`: stack, directory map, data flow, authentication flows, observability configuration.
- `docs/DEVELOPMENT.md`: local setup, environment variables, scripts, database workflows, testing, and tooling.
- `docs/CONTRIBUTING.md`: branch names, Conventional Commits, dependency and environment variable rules.
- `README.md`: overview, quickstart, local services.

## Writing documentation

Each kind of content has exactly one home. Decide the home before you write:

- **What shipped**: `CHANGELOG.md` at the repository root, curated by the maintainer. Never add, edit, or remove a changelog entry, even for work that ships. Acceptance detail stays in the PR.
- **Why a decision was made**: `docs/adrs/`.
- **How to do a procedure**: `docs/DEVELOPMENT.md`, `DEPLOYMENT.md`, `CONTRIBUTING.md`.
- **What is true about the system now**: `docs/ARCHITECTURE.md`.

`ARCHITECTURE.md` is undated: no ticket ids (`PTR-*`), no per-story narrative, and no one-time release instructions ("apply migration 0011"). If a sentence makes sense only in the release that introduced it, it belongs in the PR description, not in architecture. Anything architectural that must outlive a release goes in an ADR. A rule that already has a home gets a link, not a second copy.

Write and edit docs in [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/) (STE100) first. Then apply the [no-ai-slop](https://raw.githubusercontent.com/petergyang/no-ai-slop/refs/heads/main/skills/no-ai-slop/SKILL.md) rules: active voice, concrete facts over abstractions, no filler openers, and no binary contrasts. STE100 takes precedence where the two sets of rules conflict. Use an em dash only where it is better than a comma or a full stop. Prose budget: a paragraph ≤ 4 lines, and a list item ≤ 3 sentences. More than that needs a table, a list, or its own document, not a bigger paragraph.

## Running a single test

`package.json` exposes whole-suite scripts only. To target one test, pass the path through:

```bash
bun run vitest run tests/unit/auth-session.test.ts            # one file
bun run vitest run tests/unit/auth-session.test.ts -t "returns null"   # one case
bun run test:e2e tests/e2e/landing.test.ts            # one E2E file (forwards the filter)
```

## Verifying changes

Before you call work done, run `bun run lint:check`, `bun run type:check`, and `bun run format:check`. Also run the suite that your change touches (`test:unit`, `test:integration`, or `test:e2e`). Full list: `docs/CONTRIBUTING.md` §Pre-PR Verification.

## Test layout gotchas

- `test:unit` runs the Vitest `unit` project (`vitest run --project unit`), targeting `tests/unit/` with `jsdom` environment.
- `test:integration` runs the Vitest `integration` project (`vitest run --project integration`), targeting `tests/integration/` with `node` environment.
- Unit tests must not start a database container. Keep them to pure logic, and use Testcontainers in integration and E2E tests only.
- Coverage is `enabled: true` in `vitest.config.ts`, so test runs rewrite `coverage/`.

## Client/server boundary

- TanStack Start compiles the server functions that `createServerFn` exports and routes consume for the client environment. It strips `.handler(...)` bodies, but it preserves all other `export` declarations.
- Never statically import runtime built-ins or server-only dependencies at module level in a client-reachable module. These dependencies are `#/db`, **`#/db/schema`**, and `"bun"`. The import alone is sufficient. It does not need an exported helper that references it.

  Drizzle calls `pgTable()` at module scope to build its tables, and a bundler cannot prove that call side-effect free. The bundler therefore retains the module whole, and Dead Code Elimination drops nothing. A `<feature>.server.ts` module (see below) is the sanctioned exception. No client-reachable module imports it, so a static import there never reaches the bundle.

- `#/db/schema` is the trap: unlike `#/db`, it does **not** fail `bun run build`. It silently serves the entire database schema, Better Auth tables included, to the browser.

  `tests/unit/client-bundle-safety.test.ts` walks every module under `src/features`, `src/hooks`, `src/lib`, and `src/components`. It discovers the modules and does not use a list. This test is the only check that catches the problem. When you add a server-only _dependency_, not a module, add its specifier to that test's `SERVER_ONLY_IMPORT`.

- Instead, reach server dependencies dynamically inside `.handler()` with `await import("#/db")`, or inside a middleware's `.server()` callback, as `src/features/auth/session.ts` does. Import server types with `import type`, and require injected dependencies in exported helpers (for example `database: Database`). Never anchor `database = db` as a default parameter on an exported function. The same test rejects that pattern and expects the caller to pass `database`.
- Do **not** give a client-reachable module the `<feature>.server.ts` suffix. The import-protection plugin in `@tanstack/start-plugin-core` denies `**/*.server.*` in the client environment, so `bun run build` fails at the first route that imports the module. Only `build` fails: `type:check` and the test suites stay green. Use that suffix only for modules that nothing client-reachable imports, like `event-requests/drafts.server.ts`.

## File layout and naming

- A page view is a feature component, not a route: `src/features/<feature>/components/<page>-page.tsx`, which takes its route data (context, loader data, search) as props. The route file keeps only wiring (search validation, guards, loaders, metadata, and pending or error components), and it binds the two together with `component: () => <Page {...Route.use*()} />`. `tests/unit/route-module-boundaries.test.ts` fails if a route module declares anything but `Route`, or if it reaches for React state.
- No `-model` suffix, and no entity-name stutter (`venues/venues-fns.ts`). A helper with only one caller lives in that caller's file, even if a unit test also imports and tests it. Export it from the caller's file for the test. Extract a helper into its own file only when it has two or more application callers.

## Server functions

- Every `createServerFn` declares `.middleware([...])`. Session and permission enforcement runs there, never in the handler. `tests/unit/server-function-middleware.test.ts` fails the suite if a function omits the middleware. `tests/integration/server-function-authorization.test.ts` proves that a refusal runs before the handler.
- Validation lives in the Zod schema, which the code parses with `safeParse` and rethrows as `issues[0].message`. Never let a raw `ZodError` reach a route.

## Imports

`#/...` is the only alias for `src/`. It lives in three places that must stay in sync (`tsconfig.json` `paths`, `package.json` `imports`, and `vitest.config.ts` `alias`). A new alias therefore means touching all three files, or it typechecks and then fails under test. `components.json` already generates `#/`, so shadcn output needs no rewriting. Workflow: `docs/DEVELOPMENT.md` §Imports and Path Aliases.

## Adding an environment variable

You must update three places:

- `src/env.ts` (optional unless the application cannot boot without it)
- `.env.example` (a commented entry)
- `README.md` (only if the variable changes the setup steps)

Workflow: `docs/DEVELOPMENT.md` §Adding Environment Variables.

## Database schemas and migrations

When you touch a schema file (`src/db/schema.ts`, `src/db/auth-schema.ts`), run `bun run db:generate`. Review the generated DDL in `src/db/drizzle/`. Commit the schema with its migration together.

Never handwrite SQL. Never use `db:push` outside local prototyping, because it records no migration history.

Two reviewed exceptions are the exclusion constraints that Drizzle cannot express. Add them with `db:generate --custom`: `venue_requests_no_overlap` (migration 0019) and `venue_holds_no_overlap` (migration 0024). ADR-5 documents both (`docs/adrs/ADR-5-venue-booking-overlap.md`). Workflow: `docs/DEVELOPMENT.md` §Migration Rules.
