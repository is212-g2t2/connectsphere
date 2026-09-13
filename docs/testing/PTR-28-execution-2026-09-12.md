# PTR-28 execution log — 12 September 2026

**Historical snapshot:** this log covers the helper implementation before the user authorised the unaffected calendar UI and access-control work. See [the later execution log](./PTR-28-ui-execution-2026-09-12.md) for current results. The records below are preserved as observed at that earlier stage.

This appends execution records to [specification v1.0](./PTR-28-test-cases.md). The original Not Executed records remain historical. **PTR-28 is incomplete: no complete acceptance case is claimed as passed.** Only the independent projection and permission helpers are implemented. There is no calendar page, server entry point, database reader, or PTR-28 PostgreSQL/browser fixture yet.

## Scope and dependency refresh

- Branch: `yuhanhuang2024/ptr-28`; base HEAD `8d0c7a8a34ae969f330139e558f7c819cd432407`, plus the uncommitted files in this task.
- [PTR-28](https://linear.app/is212-petra/issue/PTR-28/see-when-a-venue-is-free): In Progress.
- [PTR-26](https://linear.app/is212-petra/issue/PTR-26/maintain-the-record-for-a-venue): Todo, assigned to Qing Jia. Both listed dependencies are Done: PTR-7 and PTR-59. The latest issue comment says the work has not started. No PTR-26 branch was returned by the connected GitHub branch search.
- [PTR-59](https://linear.app/is212-petra/issue/PTR-59/seed-the-staff-accounts-and-demo-data-the-team-builds-against): Done for staff-account work. Its issue sequencing and [PR 6](https://github.com/is212-g2t2/connectsphere/pull/6) explicitly defer venue records and recorded unavailability to PTR-26's schema.
- [PTR-31](https://linear.app/is212-petra/issue/PTR-31/request-a-venue-for-my-event) and [PTR-33](https://linear.app/is212-petra/issue/PTR-33/approve-a-booking): Backlog. **The user confirmed both are outside this sprint.** No booking persistence or booking-management work was performed.
- The missing PTR-26 output, rather than an unfinished prerequisite of PTR-26 itself, prevents database-backed venue/block availability here. Booking AC3 remains prepared in pure fixtures and deferred at database level.
- No schema definitions or generated migrations were changed. Existing local migrations were applied successfully as a verification step; `db:generate` was not applicable.
- Existing `package.json`, `bun.lock` and `docker-compose.yaml` changes were preserved. No commits, pushes, Linear writes or teammate messages.

## Fixture and implementation limits

`tests/fixtures/ptr-28.ts` creates fresh PTR28_BASE v1 arrays before each unit case, including both venues, the five accounts, event ownership, all six booking/request rows, all four blocks and the three date ranges. TC06 replaces B01; each TC09 variant adds only its own boundary record after a fresh reset. TC12/TC16 empty only local arrays.

UTC+08:00, `Asia/Singapore`, the October test clock and all-day openings are test conventions only. The code has no current-time dependency, so no test depends on the machine clock or timezone. Selected-date conversion is not implemented. The proposed helper request is `{ venueId, startsAt, endsAt }` with explicit-offset timestamps; it is **not an agreed HTTP endpoint contract**.

`projectAvailability` accepts complete venue occupancy and explicit opening periods. It preserves original timestamps separately from the clipped visible extent, keeps overlapping records, and subtracts their union from opening periods. It requires a caller-selected pending treatment (`hold` or `no-hold`), with no production default. Both choices are unit-tested; neither constitutes a product decision. Positive-duration [start, end) interval arithmetic does not establish whether future booking operations permit adjacent bookings or require buffers.

Timezone, operating-hours treatment, adjacent-booking rules and Technical Support Staff entitlement remain unconfirmed. Only Event Coordinator and Venue Staff receive the new read grant. The technical-support role retains its previous permissions. Page and server enforcement are still outstanding.

## Test-first history

Executor for every record: Codex. Date: 12 September 2026, Asia/Singapore. Environment: Windows/PowerShell, Bun 1.4.2, Node 24.19.0, Vitest 5.0.0; unit tests use jsdom and no database containers.

| Run  | Subject/level                          | Actual result                                                                                                            | Status  | Remarks                                                                                          |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| R0   | Projection suite, unit                 | Vite failed before test discovery with `spawn EPERM`.                                                                    | Blocked | Sandbox subprocess restriction; no feature assertion executed. Retried outside the sandbox.      |
| R1   | Projection suite, unit                 | Import resolution failed because `#/features/venues/availability` did not exist. One failed suite, zero collected tests. | Blocked | Confirms fixtures/tests preceded feature implementation; does not count as 22 failed assertions. |
| R2   | Projection suite, unit                 | 22 tests passed after implementing the projection and explicit-instant validator.                                        | Pass    | Helper coverage only; initial targeted run disabled coverage instrumentation.                    |
| R3-A | PTR-28-TC01, supplemental unit         | Permission returned false where true was expected.                                                                       | Fail    | Test written and run before adding the availability matrix resource.                             |
| R3-B | PTR-28-TC02, supplemental unit         | Permission returned false where true was expected.                                                                       | Fail    | Same pre-implementation run; the nine refusal/invalid-role checks passed.                        |
| R4   | Projection and permission suites, unit | All 33 tests passed after the permission change.                                                                         | Pass    | Page and endpoint coverage remains blocked.                                                      |
| R5   | Final targeted unit verification       | All 33 tests passed after lint fixes.                                                                                    | Pass    | Started 21:43:45 SGT; exact per-test results in [JSON evidence](./ptr28-unit-run.json).          |

Final targeted command:

```powershell
bun run vitest run --project unit tests/unit/venue-availability.test.ts tests/unit/venue-availability-permissions.test.ts --coverage.enabled=false --maxWorkers=1 --pool=threads --reporter=dot --reporter=json --outputFile=docs/testing/ptr28-unit-run.json
```

## R5 execution records by case and unit variant

Each row is a separate execution record for the exact test name in the JSON report. Pass applies only to the helper assertions in that row. In particular, TC01/TC02/TC07/TC10/TC11/TC12/TC14/TC18 unit checks are supplemental to the specification's planned browser/integration levels. TC17 verifies explicit fixture policies, not an agreed product hold policy.

| Record | Case, variant and tested behaviour                                                                         | Level | Status | Actual result                                   | Remarks                                                                          | Executed by | Execution date |
| ------ | ---------------------------------------------------------------------------------------------------------- | ----- | ------ | ----------------------------------------------- | -------------------------------------------------------------------------------- | ----------- | -------------- |
| U01    | [PTR-28-TC01][AC1] grants the story's event_coordinator role availability read access                      | Unit  | Pass   | Assertions completed in 2.1162000000001626 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U02    | [PTR-28-TC02][AC1] grants the story's venue_staff role availability read access                            | Unit  | Pass   | Assertions completed in 0.17039999999997235 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U03    | [PTR-28-TC14-A][AC5] refuses attendee at the permission helper                                             | Unit  | Pass   | Assertions completed in 0.65300000000002 ms.    | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U04    | [PTR-28-TC14-B][AC5] refuses event_organiser at the permission helper                                      | Unit  | Pass   | Assertions completed in 0.18509999999992033 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U05    | [PTR-28-TC18-B][AC1][AC5] refuses a missing session at the permission helper                               | Unit  | Pass   | Assertions completed in 0.13740000000007058 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U06    | [PTR-28-TC14][AC5] fails closed for the malformed role undefined                                           | Unit  | Pass   | Assertions completed in 0.13229999999998654 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U07    | [PTR-28-TC14][AC5] fails closed for the malformed role null                                                | Unit  | Pass   | Assertions completed in 0.0805000000000291 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U08    | [PTR-28-TC14][AC5] fails closed for the malformed role ''                                                  | Unit  | Pass   | Assertions completed in 0.06999999999993634 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U09    | [PTR-28-TC14][AC5] fails closed for the malformed role 'admin'                                             | Unit  | Pass   | Assertions completed in 0.07580000000007203 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U10    | [PTR-28-TC14][AC5] fails closed for the malformed role 'attendee,event_coordinator'                        | Unit  | Pass   | Assertions completed in 0.09510000000000218 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U11    | [PTR-28-TC14][AC5] fails closed for the malformed role 'event_coordinator '                                | Unit  | Pass   | Assertions completed in 0.04809999999997672 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U12    | [PTR-28-TC05][AC2] separates available, confirmed and blocked periods                                      | Unit  | Pass   | Assertions completed in 3.6243999999999232 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U13    | [PTR-28-TC06][AC3] preserves exact 10:15–11:45 booking times                                               | Unit  | Pass   | Assertions completed in 0.576799999999821 ms.   | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U14    | [PTR-28-TC07][AC3] includes another coordinator's booking in the projection                                | Unit  | Pass   | Assertions completed in 0.4172000000000935 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U15    | [PTR-28-TC08][AC3] retains an overnight booking's original extent                                          | Unit  | Pass   | Assertions completed in 0.22769999999991342 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U16    | [PTR-28-TC09-A][AC1][AC3] includes overlap without changing stored times                                   | Unit  | Pass   | Assertions completed in 0.3223000000000411 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U17    | [PTR-28-TC09-B][AC1][AC3] includes overlap without changing stored times                                   | Unit  | Pass   | Assertions completed in 0.22900000000004184 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U18    | [PTR-28-TC10-A][AC1][AC3][AC4] excludes B04 while retaining positive controls                              | Unit  | Pass   | Assertions completed in 0.678000000000111 ms.   | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U19    | [PTR-28-TC10-B][AC1][AC3][AC4] excludes U03 while retaining positive controls                              | Unit  | Pass   | Assertions completed in 0.22810000000004038 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U20    | [PTR-28-TC10-C][AC1][AC3][AC4] excludes B05 while retaining positive controls                              | Unit  | Pass   | Assertions completed in 0.21100000000001273 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U21    | [PTR-28-TC10-D][AC1][AC3][AC4] excludes U04 while retaining positive controls                              | Unit  | Pass   | Assertions completed in 0.2602999999999156 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U22    | [PTR-28-TC11][AC2][AC4] returns blocks alongside bookings                                                  | Unit  | Pass   | Assertions completed in 0.1331000000000131 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U23    | [PTR-28-TC12][AC4] returns blocks independently of bookings                                                | Unit  | Pass   | Assertions completed in 0.1065000000000964 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U24    | [PTR-28-TC16][AC2] derives an available day only from explicitly supplied opening periods                  | Unit  | Pass   | Assertions completed in 0.07940000000007785 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U25    | [PTR-28-TC17][AC2][AC3] never labels a pending request as confirmed                                        | Unit  | Pass   | Assertions completed in 0.09550000000012915 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U26    | [PTR-28-TC05][AC2] preserves overlapping booking/block records without false free gaps                     | Unit  | Pass   | Assertions completed in 0.10779999999999745 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U27    | [PTR-28-TC16][AC2] does not assume a venue is open when opening periods are absent                         | Unit  | Pass   | Assertions completed in 0.07770000000004984 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U28    | [PTR-28-TC17][AC2][AC3] requires the caller's pending-hold policy and supports a hold without confirmation | Unit  | Pass   | Assertions completed in 0.1533999999999196 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U29    | [PTR-28-TC15-A][AC1] rejects invalid input with a plain message                                            | Unit  | Pass   | Assertions completed in 2.1145000000001346 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U30    | [PTR-28-TC15-C][AC1] rejects invalid input with a plain message                                            | Unit  | Pass   | Assertions completed in 0.3324999999999818 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U31    | [PTR-28-TC15-D][AC1] rejects invalid input with a plain message                                            | Unit  | Pass   | Assertions completed in 0.1550999999999476 ms.  | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U32    | [PTR-28-TC15-E][AC1] rejects invalid input with a plain message                                            | Unit  | Pass   | Assertions completed in 0.17150000000015098 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |
| U33    | [PTR-28-TC15][AC1] compares offset timestamps by instant rather than text                                  | Unit  | Pass   | Assertions completed in 0.08330000000000837 ms. | Fixture PTR28_BASE v1; helper only; JSON fullName identifies this exact variant. | Codex       | 2026-09-12     |

## Outstanding execution records by case, variant and planned level

These were assessed for readiness rather than run against a fabricated endpoint/schema. All required levels not proven by the unit records are listed below. Booking persistence stays outside this sprint, as requested.

| Case / variant | Level          | Status  | Actual result                                                                    | Remarks / blocker                                                                                      | Executed by | Execution date |
| -------------- | -------------- | ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- | -------------- |
| PTR-28-TC01    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Calendar route, shared venue fixture and database adapter absent.                                      | Codex       | 2026-09-12     |
| PTR-28-TC02    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Calendar route, shared venue fixture and database adapter absent.                                      | Codex       | 2026-09-12     |
| PTR-28-TC03    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue fixture, database reader and venue-selection flow absent.                                 | Codex       | 2026-09-12     |
| PTR-28-TC03    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue fixture, database reader and venue-selection flow absent.                                 | Codex       | 2026-09-12     |
| PTR-28-TC04    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue fixture, date-range contract and calendar flow absent.                                    | Codex       | 2026-09-12     |
| PTR-28-TC04    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue fixture, date-range contract and calendar flow absent.                                    | Codex       | 2026-09-12     |
| PTR-28-TC05    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No rendered calendar; unit states do not verify visible or accessible labels.                          | Codex       | 2026-09-12     |
| PTR-28-TC06    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; calendar not implemented.                                    | Codex       | 2026-09-12     |
| PTR-28-TC06    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; calendar not implemented.                                    | Codex       | 2026-09-12     |
| PTR-28-TC07    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; helper cannot prove cross-event database visibility.         | Codex       | 2026-09-12     |
| PTR-28-TC07    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; helper cannot prove cross-event database visibility.         | Codex       | 2026-09-12     |
| PTR-28-TC08    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; no real overnight database query.                            | Codex       | 2026-09-12     |
| PTR-28-TC09-A  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; no real boundary-overlap database query.                     | Codex       | 2026-09-12     |
| PTR-28-TC09-B  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; no real boundary-overlap database query.                     | Codex       | 2026-09-12     |
| PTR-28-TC10-A  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared schema/fixtures and reader absent; booking variants also deferred this sprint.                  | Codex       | 2026-09-12     |
| PTR-28-TC10-B  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared schema/fixtures and reader absent; booking variants also deferred this sprint.                  | Codex       | 2026-09-12     |
| PTR-28-TC10-C  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared schema/fixtures and reader absent; booking variants also deferred this sprint.                  | Codex       | 2026-09-12     |
| PTR-28-TC10-D  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared schema/fixtures and reader absent; booking variants also deferred this sprint.                  | Codex       | 2026-09-12     |
| PTR-28-TC11    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Recorded-block source absent; booking persistence deferred this sprint.                                | Codex       | 2026-09-12     |
| PTR-28-TC11    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Recorded-block source absent; booking persistence deferred this sprint.                                | Codex       | 2026-09-12     |
| PTR-28-TC12    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared recorded-block schema and reader absent.                                                        | Codex       | 2026-09-12     |
| PTR-28-TC13-A  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Calendar route and authorised positive-control flow absent.                                            | Codex       | 2026-09-12     |
| PTR-28-TC13-B  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Calendar route and authorised positive-control flow absent.                                            | Codex       | 2026-09-12     |
| PTR-28-TC14-A  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No calendar server entry point or agreed HTTP request contract; helper checks are supplemental.        | Codex       | 2026-09-12     |
| PTR-28-TC14-B  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No calendar server entry point or agreed HTTP request contract; helper checks are supplemental.        | Codex       | 2026-09-12     |
| PTR-28-TC15-B  | Unit           | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | A nonexistent venue requires the shared venue lookup; timestamp validation cannot establish existence. | Codex       | 2026-09-12     |
| PTR-28-TC15-A  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-A  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-B  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-B  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-C  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-C  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-D  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-D  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-E  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC15-E  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No server entry point/form. Date-only to instant conversion awaits timezone/range agreement.           | Codex       | 2026-09-12     |
| PTR-28-TC16    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue reader/calendar absent; all-day opening remains a fixture convention.                     | Codex       | 2026-09-12     |
| PTR-28-TC16    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Shared venue reader/calendar absent; all-day opening remains a fixture convention.                     | Codex       | 2026-09-12     |
| PTR-28-TC17    | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Booking persistence excluded this sprint; product pending-hold policy still unresolved.                | Codex       | 2026-09-12     |
| PTR-28-TC18-A  | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | Calendar route absent; anonymous helper rejection does not prove a page redirect.                      | Codex       | 2026-09-12     |
| PTR-28-TC18-B  | Integration    | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No calendar endpoint; helper error does not prove an HTTP 401 response.                                | Codex       | 2026-09-12     |
| PTR-28-TC19    | Unit/component | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No asynchronous calendar view or retry flow exists to exercise loading failure/recovery.               | Codex       | 2026-09-12     |
| PTR-28-TC19    | Browser        | Blocked | Required test subject/fixture unavailable; no assertions executed at this level. | No asynchronous calendar view or retry flow exists to exercise loading failure/recovery.               | Codex       | 2026-09-12     |

## Regression verification

These are regression results, not PTR-28 integration/browser acceptance coverage.

| Check                     | Observed result      | Scope/evidence                                                                                                                     |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bun run type:check`      | Pass                 | TypeScript completed with exit 0.                                                                                                  |
| `bun run lint:check`      | Pass                 | Initial mutable-sort and conditional-assertion findings fixed; rerun exit 0.                                                       |
| Production build          | Pass                 | Client, SSR and Nitro output generated. Vite emitted a bundle-size warning. No calendar route exists for the build to exercise.    |
| Full unit suite           | 141 passed, 16 files | Includes 33 PTR-28 tests and two additional automatic client-safety checks for the new feature module. Coverage thresholds passed. |
| Integration suite         | 32 passed, 4 files   | Existing tests ran against an isolated PostgreSQL 18 testcontainer; schema setup succeeded. No PTR-28 database assertions.         |
| Existing local migrations | Pass                 | `bun run db:migrate` reported migrations applied successfully before E2E.                                                          |
| Browser suite             | 17 passed, Chromium  | Existing regression tests against localhost:3000 with explicit local DATABASE_URL. No PTR-28 browser assertions.                   |
| Formatting                | Pass                 | `bun run format:check` completed with exit 0; all 184 matched files use the correct format.                                        |

Commands used for full regression:

```powershell
bun run test:unit --maxWorkers=2 --pool=threads --reporter=dot --reporter=json --outputFile=test-results/ptr28-unit.json
bun run test:integration --maxWorkers=2 --pool=threads
bun run build
$env:PATH = 'C:\Users\Admin\AppData\Roaming\npm\node_modules\bun\bin;' + $env:PATH
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/app'
bun run db:migrate
bun run test:e2e --workers=2 --reporter=line
```

## Next integration step

Consume PTR-26's shared venue and recorded-unavailability schema and migrations once available, agree the selected-date/timezone and operating-hours contract, then write isolated database fixtures and real endpoint/browser tests before implementing that adapter and route. Reuse the Calendar and design system for the page, and enforce the shared permission on both entry points. Keep loading/empty/error/retry UI and the unknown-venue validation case in that next test-first slice. Booking persistence/AC3 integration remains deferred this sprint; its fixture tests are ready for later use.
