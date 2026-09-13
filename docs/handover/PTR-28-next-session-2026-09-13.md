# PTR-28 next-session handover — 13 September 2026

Continue implementing PTR-28 in `D:\SMU\SPM\connectsphere` using a test-first workflow. Work on the existing `yuhanhuang2024/ptr-28` branch and preserve all current tracked and untracked work. **PTR-26's venue schema and seed implementation already exist on `qingjiakoh2024/ptr-26`; use them now to develop real venue and recorded-unavailability reads. Do not wait for the entire PTR-26 PR to merge.** PTR-31 and PTR-33 are explicitly outside this sprint.

The next deliverable is to extend the existing calendar with database-backed venue selection and recorded blocks, with real integration and browser tests. Treat development against the available schema and reconciliation with current main as separate tasks. A draft PR or migration conflict does not by itself block adapter implementation or isolated database tests. Seed code being available does not mean those rows already exist in this checkout's local database; verify setup in the chosen test environment.

Do not commit, push, merge a GitHub PR, change Linear records or contact teammates unless requested. Do not replace the calendar implementation or create competing venue/booking tables. Inspect Git status before edits. Protect the dirty worktree before integrating upstream changes; do not reset or check out over it, or discard untracked tests/evidence. The previous session fetched remote objects and computed conflicts, but did not merge or rebase any branch.

## Read first

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/CONTRIBUTING.md`
- `docs/DESIGN.md`
- `docs/testing/PTR-28-test-cases.md` — original 19-case specification; preserve case IDs and historical records.
- `docs/testing/PTR-28-execution-2026-09-12.md` — historical helper implementation results.
- `docs/testing/PTR-28-ui-execution-2026-09-12.md` — latest implementation and per-case execution evidence.

All paths above are relative to `D:\SMU\SPM\connectsphere`.

## Verified upstream state and review findings

Refresh this snapshot at the start of the next session; do not assume the PR is merged because the implementation was described as done.

- [PTR-26 / GitHub PR #10](https://github.com/is212-g2t2/connectsphere/pull/10), branch `qingjiakoh2024/ptr-26`, reviewed head `34e1015b082298ed720b5b181855e913b4d541ac`.
- On 13 September it was **open, draft, unmerged and not mergeable**. [Linear PTR-26](https://linear.app/is212-petra/issue/PTR-26/maintain-the-record-for-a-venue) was **In Review**, assigned to Qing Jia.
- The current local PTR-28 HEAD is `8d0c7a8a34ae969f330139e558f7c819cd432407`. Fetched `origin/main` is `dad645e9f5527067737ce7079bca1c450247d8b7`, which includes the event-request work from PRs #12 and #11. PR #10's recorded base is still `8d0c7a8`.
- The six GitHub Actions workflows associated with the reviewed PR head passed: [Code Quality](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034078), [Unit](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034102), [Integration](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034006), [E2E](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034157), [Build](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034096), and [Security](https://github.com/is212-g2t2/connectsphere/actions/runs/34708034103). The actual E2E and quality job steps were also checked. These results do not validate a resolution against the newer main.
- Prior review threads were resolved; the last automated review approved `34e1015`. Independent source inspection found the venue/block schema suitable as PTR-28's data source, with the integration adaptations below. No GitHub review was posted in this session, and the PR suites were not rerun locally.

**Integration task — reconcile the migration chain before combining with current main.** This does not prevent development against the PTR-26 branch and its coherent migration chain in an isolated database. PTR-26 adds `0003_groovy_blonde_phantom`, while current main already owns migrations `0003_huge_scarlet_witch`, `0004_add_full_event_requirements` and `0005_replace_date_range_with_lines`. The PR's snapshot correctly links to its own `0002` parent, but that is not a combined upgrade path. A non-working-tree `git merge-tree` check against current main confirmed ten conflicted paths:

```text
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
src/db/schema.ts
src/db/drizzle/meta/0003_snapshot.json
src/db/drizzle/meta/_journal.json
src/features/auth/permissions.ts
src/lib/seo.ts
src/routes/dashboard.tsx
tests/unit/auth-permissions.test.ts
tests/unit/seo.test.ts
```

The upstream owner needs to resolve the schema while preserving main's event-request definitions, preserve main's existing migration history, and regenerate the venue migration from the combined schema with `bun run db:generate`. Do not concatenate the competing journals, handwrite SQL, or treat `db:push` as proof that the upgrade path works. Validate both a fresh database and an upgrade from current main. The integration test setup currently uses `db:push`, so its passing result alone cannot establish migration safety. Source: [PR journal entry](https://github.com/is212-g2t2/connectsphere/blob/34e1015b082298ed720b5b181855e913b4d541ac/src/db/drizzle/meta/_journal.json#L26).

**Test reliability finding — pin the seed test clock.** `tests/integration/seed-venues.test.ts` compares fixed March/April 2027 seed dates with `new Date()`. The assertion will fail as those dates pass, even with unchanged code; it also compares PostgreSQL's space-separated timestamp with an ISO timestamp containing `T`. The first period compared against `2027-03-02T00:00:00.000Z` already demonstrates the future-assertion failure. Use a controlled clock and consistent wall-clock representation for the assertion while retaining idempotent fixed seed rows. This was source-reviewed and the comparison checked, not a new full test-suite run. Source: [seed test lines 37–44](https://github.com/is212-g2t2/connectsphere/blob/34e1015b082298ed720b5b181855e913b4d541ac/tests/integration/seed-venues.test.ts#L37).

The assessment is **suitable schema to build against now, but not merge-ready at the reviewed snapshot**. Refresh its head before use, and recheck migration resolution before combining it with current main. Neither the merge conflict nor the seed-clock finding is a reason to stop PTR-28 development. Repairing or publishing changes to the teammate's branch is not authorised by this handover.

## Existing PTR-28 implementation — extend it

- `src/features/venues/availability.ts`: pure projection of approved bookings, independent blocks and supplied opening periods. Preserves original timestamps, clips visible overlap, computes free periods, and requires explicit pending-hold treatment. Its types are read projections, not persistence schemas.
- `src/features/venues/calendar-data.ts`: validated `CalendarSource` interface and HTTP client. Takes `{ venueId, startDate, endDate }` using string IDs and inclusive civil dates. Returns a `CalendarSchedule` containing venue, selected dates, IANA timezone, available periods and occupied periods with original/visible timestamps. Rejects wrong-selection or malformed responses and preserves cancellation signals.
- `src/features/venues/calendar.tsx`: working calendar UI, shared date picker, venue selector, exact-time/overnight display, seven-day pagination, state labels, loading, empty, error and retry handling. Removes stale results when filters change or requests fail.
- `src/routes/venues.availability.tsx`: real protected `/venues/availability` page. Anonymous users redirect to login; external roles see access denied.
- `src/routes/api/venue-availability.ts` and `.venues.ts`: real session/permission checks, private/no-store responses, 401/403 refusals and schedule-input validation. Authorised valid requests currently return 503. Replace these stubs with real readers against the available PTR-26 schema; retain error handling for actual failures.
- `src/features/auth/permissions.ts`: `venueAvailability:read` is granted only to Event Coordinator and Venue Staff. Dashboard navigation uses that permission.
- Existing tests: `tests/unit/venue-availability*.test.ts*`, `tests/integration/venue-availability-route.test.ts`, `tests/e2e/venue-availability.test.ts`, `tests/fixtures/ptr-28.ts` and `ptr-28-auth.ts`.

Last observed PTR-28 worktree checks on 12 September: **168 unit, 46 integration and 32 browser tests passed**, along with build, typecheck, lint and formatting. Real authentication and refusal checks passed; successful availability rendering used injected/intercepted fixtures. These are historical baseline results, not proof of the next database adapter or new upstream integration.

## PTR-26 data contract and integration cautions

The user relayed the following schema contract from the PTR-26 owner. Treat these details as clarified; do not ask again whether the tables or seed implementation exist. The older message about pushing the schema "tonight" is superseded by the verified pushed commit above.

- `src/db/schema.ts` exports `venues` and `venueUnavailability`. Both use serial integer IDs. **Look up seeded venues by name and use the returned IDs; never assume IDs 1–3**, including after seed re-runs or deletion. Convert IDs deliberately at the existing HTTP boundary; reject malformed/out-of-range IDs and distinguish an unknown venue from a venue with no occupancy. Do not use the fixture IDs `VA`/`VB` as actual database IDs.
- `venues` contains name, location, maximum capacity, facilities, accessibility features, supported layouts and `operatingHours`.
- `operatingHours` is `{ mon, tue, wed, thu, fri, sat, sun }`, with each value either `{ opens: "HH:MM", closes: "HH:MM" }` or `null` for closed. The current validator supports one same-day interval, requires closes after opens, and rejects `24:00`. It does not represent all-day or overnight opening ranges.
- The owner's description names the type `OperatingHours`. At reviewed commit `34e1015`, its export is in `#/features/venues/schema`; `#/db/schema` imports it as a type but does not re-export it. Check the latest export before choosing the import, rather than assuming the message's suggested path is exact.
- `venueUnavailability` contains `venueId`, `startsAt`, `endsAt`, `reason`; has a cascade FK, `endsAt > startsAt` constraint and unique `(venueId, startsAt, endsAt)` index. There is no recorded-unavailability management UI in this sprint.
- Crucially, its start/end columns are **timestamp without time zone**, read as strings such as `2027-03-01 00:00:00`. The owner confirms local wall-clock storage, using the same convention as the earlier event-request `proposed_start`. The existing PTR-28 projection/client expects explicit-offset instants and an IANA display timezone. This is an adapter/representation mismatch, not a missing schema. Do not pass raw strings through `new Date()`, append `Z`, or assume the machine's timezone. Preserve local wall-clock values; explicitly convert only once a timezone is agreed, or deliberately revise the calendar contract with tests to represent floating local time without inventing a timezone. Do not redesign the shared persistence schema merely to fit the earlier fixture interface.
- PTR-26's `venue:read` also permits Technical Support Staff. This does **not** authorise widening PTR-28's distinct calendar permission. Preserve `venueAvailability:read` and confirm Technical Support entitlement separately.
- Merge permission resources from main, PTR-26 and PTR-28; preserve event-request permissions, venue permissions and calendar permissions. Preserve all corresponding dashboard links. Regenerate `src/routeTree.gen.ts` and verify `/venues/availability` remains reachable alongside `/venues/$venueId`.
- PTR-26 adds `assertNotRefused` to the session helpers for TanStack server functions that resolve raw refusal Responses. Keep it and its call-site fixes. PTR-28's fetch-based JSON API can retain its current explicit HTTP handling.
- PTR-26 supplies three demo venues and two fixed 2027 blocks through `scripts/seed.ts`. E2E global setup now seeds after migration, but catches migration/seed errors as warnings. Independently verify successful migration and seed execution before claiming database-backed E2E coverage.
- Current main's event requests remain drafts with proposed date windows. They are not approved venue bookings. Do not substitute them for booking occupancy or implement PTR-31/PTR-33.

## Continue in this order

1. Check Git status, refresh PR #10's head and read the available schema on `qingjiakoh2024/ptr-26`. Make it available for PTR-28 development while preserving every current changed/untracked file. If combining it with current main would introduce conflicting migrations, use an isolated workspace/database based on the coherent PTR-26 branch for adapter implementation and real tests. Keep the PTR-28 work recoverable and bring the resulting changes back safely; do not stop at a plan or tests merely because the PR is unmerged. Reconcile the combined migration history separately before applying it to an existing-main database. Do not modify main or the teammate's branch, or silently adopt conflicting migration metadata.
2. Use the clarified local wall-clock contract. Ask only about genuinely unresolved product behaviour if the repository does not answer it: whether to display floating local time or use a named timezone, and whether operating hours constrain the calendar's available periods. A `null` day is confirmed closed; how the calendar presents closed/outside-hours periods remains to be established. Continue venue listing, numeric-ID validation, real block queries and tests while those answers are pending. Existing Asia/Singapore, UTC+08:00, all-day opening and no-hold fixtures are test conventions, not confirmed product rules. Preserve the existing calendar role restriction; unresolved Technical Support entitlement and future adjacent-booking rules do not block the authorised read work.
3. Write failing tests first for real venue listing, numeric-ID validation, unknown venue, range/venue filtering, overlapping independent blocks, closed days/opening boundaries under the agreed policy, and a saved venue edit being used on the next calendar read (PTR-26 AC5). Query overlaps by `startsAt < rangeEnd` and `endsAt > rangeStart`, not by containment. Use real date/timestamp conversions under the agreed convention and verify independence from the browser/process timezone.
4. Use isolated PostgreSQL fixtures with actual generated IDs and clear fixture revisions. Existing all-day PTR28_BASE cases cannot be copied into the upstream form schema unchanged: introduce documented compatible database fixtures, retain the original cases/evidence, and state any altered precondition. Never seed invalid hours just to force a test green.
5. Implement the shared-schema reader and replace the two authorised 503 stubs. Read the current venue data for each requested schedule. Keep real guards, first-issue validation, no-store responses, cancellation and honest error handling. No production fixture fallback.
6. Add browser tests through the real endpoints and database. Keep fixture-backed booking UI tests explicitly supplemental. AC3 and complete booking-aware acceptance remain deferred while PTR-31/PTR-33 are outside scope. Clearly identify the limited live venue/block coverage; do not report an empty booking input as proof that no confirmed bookings exist.
7. Append observed execution evidence per case ID, variant and level, distinguishing Pass, Fail, Not Executed and Blocked. Preserve all prior records. Update architecture/development docs to describe the final combined implementation and remaining limitations.
8. Run appropriate targeted checks, then required full checks: typecheck, lint, formatting, production build, unit, integration and E2E. Verify the chosen branch's migrations against a fresh isolated database now; verify the combined history against an existing-main database once reconciliation is complete. Record separately if that combined upgrade check remains blocked. Do not run unit/integration simultaneously because both rewrite `coverage/`.

Follow AGENTS.md: no database containers in unit tests; use `#/` imports; dynamically reach server dependencies from handlers; use `.server.ts` only for modules not statically reachable by client routes. Any schema change requires `bun run db:generate` and review of its generated SQL; never handwrite migrations.

## Local environment and preservation

- Windows PowerShell, Bun 1.4.2, Node 24.19.0. PostgreSQL 18, Redis, MinIO and Chromium were available previously; recheck rather than assuming they remain running. The previous dev server used `http://localhost:3000`.
- On Windows, the native Bun executable directory was needed ahead of the npm shim for subprocesses: `C:\Users\Admin\AppData\Roaming\npm\node_modules\bun\bin`.
- PTR-28 browser fixtures require explicit local `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app`; this is the local Docker configuration. Check the intended database before migration/seeding. Avoid modifying shared/demo rows; use unique test rows and clean up only those rows.
- `package.json`, `bun.lock` and `docker-compose.yaml` were already dirty before PTR-28 work. Preserve them. The current PTR-28 source, route changes, tests and execution documents also remain uncommitted.
- Local fixture screenshots are in ignored `.scratch/ptr28/desktop.png`, `mobile.png`, `dark.png` and `unavailable.png`. They do not prove live database integration.

Finish by stating what now works with real data, which checks actually ran, and what remains deferred. Do not mark PTR-28 complete while booking acceptance or required product decisions remain outstanding.
