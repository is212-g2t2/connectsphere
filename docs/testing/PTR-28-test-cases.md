# PTR-28 venue availability test cases

This document specifies the tests for **PTR-28 — See when a venue is free** before feature implementation. It records the planned behaviour to verify, the acceptance criteria each case addresses, and a separate execution record to complete after each run.

**Story:** As an Event Coordinator or Venue Staff member, I want a calendar of a venue's availability so that I can see at a glance when it can be requested.

**Source:** [PTR-28 in Linear](https://linear.app/is212-petra/issue/PTR-28/see-when-a-venue-is-free)
**Branch:** `yuhanhuang2024/ptr-28`
**Document version:** 1.0
**Created:** 12 September 2026
**Prepared by:** Codex, for Yuhan Huang

At document creation, all 19 cases were **Not Executed**. The original execution records below preserve that starting point. Run-specific execution logs and generated reports stay local and are ignored; durable review notes are maintained on [PTR-28 in Linear](https://linear.app/is212-petra/issue/PTR-28/see-when-a-venue-is-free). Passing a unit portion or fixture-backed UI check does not establish that a complete database-backed case passes. Earlier environment and baseline test results do not establish that these story-specific cases pass.

## How to use the records

The structure follows the supplied reference: **test case specification** is maintained as the definition of the case, and **test execution record** is completed separately for every run. The reference's example column is replaced with the actual case record. Acceptance Criteria and Planned Test Level are additional specification fields for traceability.

Fields marked with an asterisk are optional metadata. Keep the case ID stable; record the document version or Git commit used in each execution record. When rerunning a case, append another execution table instead of overwriting previous results. For a parameterised case, create a separate execution record for every variant and test level, using the listed suffixes.

| Execution status | Meaning                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Not Executed     | The case has been documented but has not been attempted.                                                                         |
| Pass             | Every expected result for the recorded variant and test level was verified with evidence.                                        |
| Fail             | The case ran and at least one expected result was not met. Record the discrepancy and relevant defect reference.                 |
| Blocked          | Execution could not reach a valid result because a prerequisite was unavailable. Record the blocker, dependency and next action. |

Use Remarks to record the build/commit, test level, environment, browser version where relevant, fixture revision, variant, evidence path and any defect or blocker. Actual Result should describe what was observed, rather than repeat the expected result. Do not copy authentication cookies, tokens or real credentials into evidence.

## Acceptance criteria

The criteria below are transcribed from the current Linear story. TC01–TC14 provide direct coverage. TC15–TC19 are supporting checks; their additional expectations are identified explicitly.

| Reference | Acceptance criterion                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1**   | Given an authorised internal user, when they select a venue and a date range, then its availability across that range is displayed.                                        |
| **AC2**   | Given a period within the range, when it is displayed, then it is shown in one of the recorded states: available, confirmed booking, or otherwise unavailable/blocked.     |
| **AC3**   | Given an approved booking on the venue, when the calendar covering its dates is viewed, then the booking appears for the exact period it covers, whichever event holds it. |
| **AC4**   | Given a recorded period of unavailability, when the calendar covering it is viewed, then it appears alongside bookings.                                                    |
| **AC5**   | Given a user in an external role, when they attempt to open the calendar, then access is refused.                                                                          |

## Coverage index

| Test case                   | Scenario                                                             | Acceptance criteria | Coverage   |
| --------------------------- | -------------------------------------------------------------------- | ------------------- | ---------- |
| [PTR-28-TC01](#ptr-28-tc01) | Event Coordinator views venue availability                           | AC1                 | Direct     |
| [PTR-28-TC02](#ptr-28-tc02) | Venue Staff views venue availability                                 | AC1                 | Direct     |
| [PTR-28-TC03](#ptr-28-tc03) | Changing the venue updates the displayed availability                | AC1                 | Direct     |
| [PTR-28-TC04](#ptr-28-tc04) | Changing the date range updates the displayed availability           | AC1                 | Direct     |
| [PTR-28-TC05](#ptr-28-tc05) | Available booked and blocked periods have distinct states            | AC2                 | Direct     |
| [PTR-28-TC06](#ptr-28-tc06) | An approved booking retains its exact start and end times            | AC3                 | Direct     |
| [PTR-28-TC07](#ptr-28-tc07) | A booking appears even when another coordinator holds the event      | AC3                 | Direct     |
| [PTR-28-TC08](#ptr-28-tc08) | An approved booking spanning midnight appears on both dates          | AC3                 | Direct     |
| [PTR-28-TC09](#ptr-28-tc09) | Bookings overlapping a selected range boundary are included          | AC1 and AC3         | Direct     |
| [PTR-28-TC10](#ptr-28-tc10) | Records for another venue or an unrelated date range are excluded    | AC1 AC3 and AC4     | Direct     |
| [PTR-28-TC11](#ptr-28-tc11) | Recorded unavailability appears alongside approved bookings          | AC2 and AC4         | Direct     |
| [PTR-28-TC12](#ptr-28-tc12) | Recorded unavailability appears when there are no bookings           | AC4                 | Direct     |
| [PTR-28-TC13](#ptr-28-tc13) | External roles cannot open the calendar page                         | AC5                 | Direct     |
| [PTR-28-TC14](#ptr-28-tc14) | External roles cannot retrieve availability directly from the server | AC5                 | Direct     |
| [PTR-28-TC15](#ptr-28-tc15) | Invalid calendar input is rejected clearly                           | AC1                 | Supporting |
| [PTR-28-TC16](#ptr-28-tc16) | A valid empty schedule displays available periods                    | AC2                 | Supporting |
| [PTR-28-TC17](#ptr-28-tc17) | A pending booking request is not displayed as confirmed              | AC2 and AC3         | Supporting |
| [PTR-28-TC18](#ptr-28-tc18) | Signed-out users cannot access calendar data                         | AC1 and AC5         | Supporting |
| [PTR-28-TC19](#ptr-28-tc19) | A data retrieval failure is shown as an error                        | AC1 and AC2         | Supporting |

| Acceptance criterion | Direct cases                       | Supporting cases |
| -------------------- | ---------------------------------- | ---------------- |
| AC1                  | TC01, TC02, TC03, TC04, TC09, TC10 | TC15, TC18, TC19 |
| AC2                  | TC05, TC11                         | TC16, TC17, TC19 |
| AC3                  | TC06, TC07, TC08, TC09, TC10       | TC17             |
| AC4                  | TC10, TC11, TC12                   | None             |
| AC5                  | TC13, TC14                         | TC18             |

## Readiness and decisions

At document creation, the repository has authentication and role checks but no venue, booking or blocked-period application tables. The cases can be reviewed now; executable fixtures must use the shared schema once agreed.

- **Venue records:** coordinate with [PTR-26](https://linear.app/is212-petra/issue/PTR-26/maintain-the-record-for-a-venue).
- **Demo and blocked-period data:** [PTR-59](https://linear.app/is212-petra/issue/PTR-59/seed-the-staff-accounts-and-demo-data-the-team-builds-against) includes these requirements; the local seed currently provisions accounts only.
- **Booking records and statuses:** align the fixture contract with [PTR-31](https://linear.app/is212-petra/issue/PTR-31/request-a-venue-for-my-event) and [PTR-33](https://linear.app/is212-petra/issue/PTR-33/approve-a-booking).
- Confirm the product timezone, operating-hours treatment, adjacent-period boundary rule and Technical Support Staff entitlement before adding assertions for those decisions.
- Confirm the additional validation, pending-request and failure-recovery expectations in TC15–TC19 before treating them as agreed feature requirements.

The proposed page is `/venues/availability`; its route and server-function request contract are not implemented yet. Record the agreed URL, request method and request shape before executing endpoint cases. Do not invent a passing result when these prerequisites are unavailable.

## Shared test setup and data

### P0 baseline preconditions

P0 applies to every case unless its Pre-conditions row provides an explicit override.

1. Use an isolated test environment with the agreed schema and migrations applied. Ensure the application or test harness can reach its own test database.
2. Reset the fixture to **PTR28_BASE** before each case or variant. PTR28_BASE is the logical dataset below, not an existing script or database table.
3. Apply only the overrides described in the case. Use fresh arrays for pure unit tests; use isolated fixtures or rollback/reseed for database tests. Unit tests must not start database containers.
4. Use a new browser/API session for each role-dependent run. Authenticate internal roles through provisioned test accounts, rather than external self-registration.
5. Fix the test clock at **01 October 2026 09:00 UTC+08:00** when time-dependent behaviour is involved. Interpret all fixture timestamps in UTC+08:00. This is a fixture convention, not confirmation of the product timezone.
6. Keep both test venues open 24 hours each day. This isolates recorded availability from the undecided real operating-hours rule.
7. Confirm the required fixtures and test subject are present before executing assertions. Restore only the isolated test fixtures after the run.

Resetting test data prevents one case's changes, bookings, blocked periods or sessions from affecting the next case. It makes failures reproducible and comparisons meaningful. Never reset shared, demo or production data as part of these cases.

### Accounts and venues

These are logical fixture identifiers. The test implementation must map them to actual IDs in the agreed schema. All addresses and credentials below are test-only.

| Fixture       | Role or record       | Details                                                                |
| ------------- | -------------------- | ---------------------------------------------------------------------- |
| COORD-A       | Event Coordinator    | `coordinator-a@example.test`; assigned coordinator of E01 and E05      |
| COORD-B       | Event Coordinator    | `coordinator-b@example.test`; assigned coordinator of E02, E03 and E04 |
| STAFF-A       | Venue Staff          | `venue-staff-a@example.test`                                           |
| ATTENDEE-A    | Attendee             | `attendee-a@example.test`                                              |
| ORGANISER-A   | Event Organiser      | `organiser-a@example.test`                                             |
| Test password | All fixture accounts | `Test-Only123!`; for isolated tests only                               |
| Venue A       | Venue VA             | Test Hall A; location Test Building A; capacity 100; open 24 hours     |
| Venue B       | Venue VB             | Test Hall B; location Test Building B; capacity 50; open 24 hours      |

### Baseline bookings and blocks

All timestamps are in October 2026, UTC+08:00. Booking status `approved` corresponds to the calendar's Confirmed booking state. Unlisted periods in these always-open fixture venues have no recorded occupancy.

| Record | Venue | Event and owner or reason | State    | Start        | End          |
| ------ | ----- | ------------------------- | -------- | ------------ | ------------ |
| B01    | A     | E01 / COORD-A             | approved | 05 Oct 10:00 | 05 Oct 12:00 |
| B02    | A     | E02 / COORD-B             | approved | 06 Oct 14:00 | 06 Oct 16:00 |
| B03    | A     | E03 / COORD-B             | approved | 06 Oct 23:00 | 07 Oct 01:00 |
| B04    | B     | E04 / COORD-B             | approved | 05 Oct 09:00 | 05 Oct 10:00 |
| B05    | A     | E05 / COORD-A             | approved | 12 Oct 10:00 | 12 Oct 12:00 |
| P01    | A     | E06 / COORD-A             | pending  | 05 Oct 16:00 | 05 Oct 17:00 |
| U01    | A     | Maintenance               | blocked  | 05 Oct 13:00 | 05 Oct 15:00 |
| U02    | A     | Operational closure       | blocked  | 07 Oct 09:00 | 07 Oct 11:00 |
| U03    | B     | Maintenance               | blocked  | 05 Oct 11:00 | 05 Oct 12:00 |
| U04    | A     | Maintenance               | blocked  | 12 Oct 13:00 | 12 Oct 15:00 |

| Range | Selected calendar dates                               |
| ----- | ----------------------------------------------------- |
| R1    | 05 through 07 October 2026, including all three dates |
| R2    | 12 October 2026 only                                  |
| R3    | 05 October 2026 only                                  |

The test implementation must convert these selected dates into timestamps using the agreed range contract. Do not silently shift the fixture dates through the machine's local timezone.

## Test case records

### PTR-28-TC01

**Event Coordinator views venue availability**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC01                                                                                                                                                                                                       |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 — direct acceptance coverage                                                                                                                                                                                  |
| Test Scenario       | Succinct objective of the test case            | Event Coordinator views venue availability.                                                                                                                                                                       |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A has a valid authenticated session. Both venue records are available for selection.                                                                                                            |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Sign in as COORD-A.<br>2. Open the venue availability calendar.<br>3. Select Venue A and R1, then apply the selection if required.<br>4. Inspect the selected venue, displayed dates and availability periods. |
| Test Data           | Specific inputs used to conduct the test       | COORD-A; Venue A; R1 (05–07 October 2026); baseline bookings and blocks.                                                                                                                                          |
| Expected Result     | Expected result from the test                  | The calendar opens successfully, identifies Venue A and covers every date in R1. Its displayed records match Venue A’s baseline bookings and blocks within R1. No access-refusal or data-loading error is shown.  |
| Planned Test Level  | Where the behaviour will be verified           | Browser                                                                                                                                                                                                           |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                   |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                 |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                              |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Requires the calendar route, venue selection and availability reader. This is the positive access case for Event Coordinators. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                |

### PTR-28-TC02

**Venue Staff views venue availability**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC02                                                                                                                                                                                                       |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 — direct acceptance coverage                                                                                                                                                                                  |
| Test Scenario       | Succinct objective of the test case            | Venue Staff views venue availability.                                                                                                                                                                             |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. STAFF-A has a valid authenticated session. Both venue records are available for selection.                                                                                                            |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Sign in as STAFF-A.<br>2. Open the venue availability calendar.<br>3. Select Venue A and R1, then apply the selection if required.<br>4. Inspect the selected venue, displayed dates and availability periods. |
| Test Data           | Specific inputs used to conduct the test       | STAFF-A; Venue A; R1; baseline bookings and blocks.                                                                                                                                                               |
| Expected Result     | Expected result from the test                  | Venue Staff can view Venue A’s availability across R1. The booking and blocked periods match those visible to COORD-A for the same selection.                                                                     |
| Planned Test Level  | Where the behaviour will be verified           | Browser                                                                                                                                                                                                           |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                   |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                 |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                              |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run independently of TC01 with a fresh browser context. Technical Support Staff access is outside this case and remains a decision to confirm. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                |

### PTR-28-TC03

**Changing the venue updates the displayed availability**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC03                                                                                                                                                                                                                                                                                                         |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 — direct acceptance coverage                                                                                                                                                                                                                                                                                    |
| Test Scenario       | Succinct objective of the test case            | Changing the venue updates the displayed availability.                                                                                                                                                                                                                                                              |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in and the calendar currently displays Venue A for R1.                                                                                                                                                                                                                                |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Confirm Venue A’s 05 October booking at 10:00–12:00 and block at 13:00–15:00 are displayed.<br>2. Change the venue selection to Venue B without changing R1.<br>3. Apply the selection if required and wait for the new results.<br>4. Compare the reader response and rendered periods with Venue B’s fixtures. |
| Test Data           | Specific inputs used to conduct the test       | Venue A: B01, B02, B03, U01 and U02. Venue B: B04 and U03. Range R1.                                                                                                                                                                                                                                                |
| Expected Result     | Expected result from the test                  | The selection identifies Venue B. B04 is shown at 09:00–10:00 on 05 October and U03 at 11:00–12:00. Venue A’s booking and blocked periods are absent from the result and the calendar.                                                                                                                              |
| Planned Test Level  | Where the behaviour will be verified           | Integration and browser                                                                                                                                                                                                                                                                                             |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                                     |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                                   |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                             |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                               |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Assert both updated data and removal of the previous venue’s periods to detect stale results. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                               |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                               |

### PTR-28-TC04

**Changing the date range updates the displayed availability**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC04                                                                                                                                                                                                                                                             |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 — direct acceptance coverage                                                                                                                                                                                                                                        |
| Test Scenario       | Succinct objective of the test case            | Changing the date range updates the displayed availability.                                                                                                                                                                                                             |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in and the calendar displays Venue A for R1.                                                                                                                                                                                              |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Confirm Venue A’s R1 records are displayed.<br>2. Change the selected range to R2 while retaining Venue A.<br>3. Apply the selection if required and wait for the new results.<br>4. Inspect the displayed date and compare the returned periods with R2’s fixtures. |
| Test Data           | Specific inputs used to conduct the test       | Venue A; initial R1; replacement R2 (12 October 2026); B05 and U04.                                                                                                                                                                                                     |
| Expected Result     | Expected result from the test                  | The calendar covers 12 October and shows B05 at 10:00–12:00 and U04 at 13:00–15:00. R1 records are absent from the current results.                                                                                                                                     |
| Planned Test Level  | Where the behaviour will be verified           | Integration and browser                                                                                                                                                                                                                                                 |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                         |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                       |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                     |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                       |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                         |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Verify the reader’s requested dates as well as the rendered date label. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                         |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                         |

### PTR-28-TC05

**Available booked and blocked periods have distinct states**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC05                                                                                                                                                                                                                                  |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC2 — direct acceptance coverage                                                                                                                                                                                                             |
| Test Scenario       | Succinct objective of the test case            | Available booked and blocked periods have distinct states.                                                                                                                                                                                   |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in. Venue A is open all day in the fixture, with no records overlapping 09:00–10:00 on 05 October.                                                                                                             |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Load Venue A for R3.<br>2. Inspect 09:00–10:00, 10:00–12:00 and 13:00–15:00.<br>3. Read the state label for each period and compare it with the underlying record type.                                                                   |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3 (05 October 2026); free interval 09:00–10:00; B01 10:00–12:00 approved; U01 13:00–15:00 blocked.                                                                                                                                 |
| Expected Result     | Expected result from the test                  | 09:00–10:00 is Available; 10:00–12:00 is Confirmed booking; 13:00–15:00 is Unavailable/blocked. The three states are understandable through visible text or accessible labels. Exact wording may vary while preserving the required meaning. |
| Planned Test Level  | Where the behaviour will be verified           | Unit and browser                                                                                                                                                                                                                             |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                              |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                            |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                                                 |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                                   |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | The mapping of database status approved to the displayed Confirmed booking state must be explicit. Colour alone is insufficient for the proposed usability check. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                                   |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                                   |

### PTR-28-TC06

**An approved booking retains its exact start and end times**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC06                                                                                                                                                                                                                                                 |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC3 — direct acceptance coverage                                                                                                                                                                                                                            |
| Test Scenario       | Succinct objective of the test case            | An approved booking retains its exact start and end times.                                                                                                                                                                                                  |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Replace B01’s times with 10:15–11:45; do not retain its original 10:00–12:00 interval. COORD-A is signed in.                                                                                                                                    |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Apply the B01 time override to the case fixture.<br>2. Request Venue A’s availability for R3.<br>3. Inspect the booking period in the reader response and calendar details.<br>4. Compare the returned and displayed timestamps with the stored fixture. |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3; B01 approved from 05 October 2026 10:15 to 11:45, UTC+08:00.                                                                                                                                                                                   |
| Expected Result     | Expected result from the test                  | B01 is displayed as a confirmed booking for exactly 10:15–11:45. The feature does not extend the booking to the whole day or round it to 10:00–12:00.                                                                                                       |
| Planned Test Level  | Where the behaviour will be verified           | Unit integration and browser                                                                                                                                                                                                                                |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                             |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                           |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                         |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                           |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Restore the baseline after the run. The assertion concerns exact booking times; it does not prescribe a visual grid size. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                           |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                           |

### PTR-28-TC07

**A booking appears even when another coordinator holds the event**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                              |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC07                                                                                                                                                                                                   |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC3 — direct acceptance coverage                                                                                                                                                                              |
| Test Scenario       | Succinct objective of the test case            | A booking appears even when another coordinator holds the event.                                                                                                                                              |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in. Event E02 is assigned to COORD-B, and COORD-A is not assigned to that event.                                                                                                |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Confirm E02 belongs to COORD-B in the test fixture.<br>2. As COORD-A, request Venue A’s availability for R1.<br>3. Locate the occupied period on 06 October.<br>4. Compare the returned interval with B02. |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R1; B02 approved for E02 on 06 October 2026 14:00–16:00; viewer COORD-A.                                                                                                                             |
| Expected Result     | Expected result from the test                  | The approved B02 period appears at 14:00–16:00 and is not offered as available. Visibility of occupancy is not filtered to events assigned to the viewer.                                                     |
| Planned Test Level  | Where the behaviour will be verified           | Integration and browser                                                                                                                                                                                       |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                               |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                             |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                    |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                      |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | This case asserts venue occupancy only. It does not grant access to another event’s private details. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                      |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                      |

### PTR-28-TC08

**An approved booking spanning midnight appears on both dates**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                       |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC08                                                                                                                                                                            |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC3 — direct acceptance coverage                                                                                                                                                       |
| Test Scenario       | Succinct objective of the test case            | An approved booking spanning midnight appears on both dates.                                                                                                                           |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Venue A has overnight booking B03, and both dates are inside R1.                                                                                                           |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Request Venue A’s availability for R1.<br>2. Inspect the occupied intervals on 06 and 07 October.<br>3. Compare their combined extent with B03’s original start and end timestamps. |
| Test Data           | Specific inputs used to conduct the test       | B03: Venue A, approved, 06 October 2026 23:00 to 07 October 2026 01:00, UTC+08:00; range R1.                                                                                           |
| Expected Result     | Expected result from the test                  | Occupancy extends from 23:00 on 06 October through 01:00 on 07 October. Neither date is omitted, and the original booking start and end remain exact.                                  |
| Planned Test Level  | Where the behaviour will be verified           | Unit and integration                                                                                                                                                                   |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                        |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                      |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                   |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                     |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | A per-day display may split the rendering at midnight, but the combined occupancy must equal the original interval. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                     |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                     |

### PTR-28-TC09

**Bookings overlapping a selected range boundary are included**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC09                                                                                                                                                                                                                                                                                                                             |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 and AC3 — direct acceptance coverage                                                                                                                                                                                                                                                                                                |
| Test Scenario       | Succinct objective of the test case            | Bookings overlapping a selected range boundary are included.                                                                                                                                                                                                                                                                            |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Add only the boundary booking for the variant under test. Reset the baseline before each variant.                                                                                                                                                                                                                           |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Run variant A from a clean baseline: add BX1 and request Venue A for R1.<br>2. Inspect the overlap on 05 October and retain the original timestamps in the record comparison.<br>3. Reset to the baseline and repeat with variant B and BX2.<br>4. Inspect the overlap on 07 October. Record separate execution results for A and B. |
| Test Data           | Specific inputs used to conduct the test       | Variant A: BX1, Venue A approved, 04 October 2026 23:00 to 05 October 2026 01:00. Variant B: BX2, Venue A approved, 07 October 2026 23:00 to 08 October 2026 01:00. Query R1 in both variants.                                                                                                                                          |
| Expected Result     | Expected result from the test                  | A: occupancy is included for 00:00–01:00 on 05 October. B: occupancy is included for 23:00 through the end of 07 October. Neither booking is omitted merely because one endpoint lies outside R1. The stored booking times remain unchanged.                                                                                            |
| Planned Test Level  | Where the behaviour will be verified           | Unit and integration                                                                                                                                                                                                                                                                                                                    |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                                                         |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                                                       |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                          |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                            |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC09-A and PTR-28-TC09-B. These variants avoid exact-touch boundaries; the exclusive-end rule remains a separate decision. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                            |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                            |

### PTR-28-TC10

**Records for another venue or an unrelated date range are excluded**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC10                                                                                                                                                                                                                                           |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC1 AC3 and AC4 — direct acceptance coverage                                                                                                                                                                                                          |
| Test Scenario       | Succinct objective of the test case            | Records for another venue or an unrelated date range are excluded.                                                                                                                                                                                    |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Baseline contains matching records and the four exclusion records listed in Test Data.                                                                                                                                                    |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Request Venue A’s availability for R1.<br>2. Confirm at least B01 and U01 are included as positive controls.<br>3. Check that each exclusion record A–D is absent from the result.<br>4. Record the result of each exclusion assertion separately. |
| Test Data           | Specific inputs used to conduct the test       | Query Venue A and R1. Exclusion variants: A=B04 (Venue B booking); B=U03 (Venue B block); C=B05 (Venue A booking on 12 October); D=U04 (Venue A block on 12 October).                                                                                 |
| Expected Result     | Expected result from the test                  | Only Venue A’s records overlapping R1 are returned. B04, U03, B05 and U04 are excluded. The positive controls remain present, so an empty response cannot satisfy this case.                                                                          |
| Planned Test Level  | Where the behaviour will be verified           | Integration                                                                                                                                                                                                                                           |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                       |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                     |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                              |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC10-A through PTR-28-TC10-D. The blocks and bookings must use the same venue and range scope. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                |

### PTR-28-TC11

**Recorded unavailability appears alongside approved bookings**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC11                                                                                                                                                                                      |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC2 and AC4 — direct acceptance coverage                                                                                                                                                         |
| Test Scenario       | Succinct objective of the test case            | Recorded unavailability appears alongside approved bookings.                                                                                                                                     |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in. Venue A contains approved booking B01 and recorded unavailability U01 on the same day.                                                                         |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Request and display Venue A’s availability for R3.<br>2. Locate B01 and U01 in the data response.<br>3. Inspect both periods in the calendar or its period details.                           |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3; B01 10:00–12:00; U01 13:00–15:00 with reason Maintenance.                                                                                                                           |
| Expected Result     | Expected result from the test                  | B01 and U01 both appear for their exact periods. B01 is identified as a confirmed booking; U01 is identified as unavailable/blocked. The block is not silently hidden when bookings are present. |
| Planned Test Level  | Where the behaviour will be verified           | Integration and browser                                                                                                                                                                          |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                  |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                         |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                           |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Displaying the maintenance reason is optional for this story; identifying the blocked period is required. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                           |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                           |

### PTR-28-TC12

**Recorded unavailability appears when there are no bookings**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                               |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC12                                                                                                                                                    |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC4 — direct acceptance coverage                                                                                                                               |
| Test Scenario       | Succinct objective of the test case            | Recorded unavailability appears when there are no bookings.                                                                                                    |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. For Venue A, remove its bookings from this case’s isolated fixture and retain U01. Do not modify a shared or demo database.                        |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Prepare the case fixture with no Venue A bookings and U01 present.<br>2. Request Venue A’s availability for R3.<br>3. Inspect the returned periods for U01. |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3; zero bookings for Venue A; U01 blocked from 13:00–15:00 on 05 October.                                                                            |
| Expected Result     | Expected result from the test                  | U01 is returned at 13:00–15:00 as unavailable/blocked. Availability retrieval does not depend on the presence of a booking row.                                |
| Planned Test Level  | Where the behaviour will be verified           | Integration                                                                                                                                                    |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                              |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                               |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                 |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                   |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Use this case to detect queries that incorrectly omit standalone blocked periods. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                   |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                   |

### PTR-28-TC13

**External roles cannot open the calendar page**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC13                                                                                                                                                                                                                                                                                                    |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC5 — direct acceptance coverage                                                                                                                                                                                                                                                                               |
| Test Scenario       | Succinct objective of the test case            | External roles cannot open the calendar page.                                                                                                                                                                                                                                                                  |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. The calendar works for an authorised control account. Use a fresh browser context for each external-role variant.                                                                                                                                                                                  |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Sign in as the external user for variant A.<br>2. Navigate directly to the calendar URL, including Venue A and R1 if supported.<br>3. Inspect the resulting page, any redirect and the visible content.<br>4. Repeat independently as variant B. Record the final URL and evidence of refusal for each run. |
| Test Data           | Specific inputs used to conduct the test       | Variant A: ATTENDEE-A. Variant B: ORGANISER-A. Direct target: the agreed calendar page, proposed /venues/availability.                                                                                                                                                                                         |
| Expected Result     | Expected result from the test                  | Both roles are refused access. No venue availability, booking times or blocked periods are rendered. The proposed presentation is an access-denied view; any agreed redirect must also refuse the calendar.                                                                                                    |
| Planned Test Level  | Where the behaviour will be verified           | Browser                                                                                                                                                                                                                                                                                                        |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                                |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                              |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                                          |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                            |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC13-A and PTR-28-TC13-B. Hiding a navigation link alone does not establish this outcome. Exact refusal-page copy is not specified by AC5. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                            |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                            |

### PTR-28-TC14

**External roles cannot retrieve availability directly from the server**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC14                                                                                                                                                                                                                                                                                                                                                      |
| Acceptance Criteria | Criterion addressed and type of coverage       | AC5 — direct acceptance coverage                                                                                                                                                                                                                                                                                                                                 |
| Test Scenario       | Succinct objective of the test case            | External roles cannot retrieve availability directly from the server.                                                                                                                                                                                                                                                                                            |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. The calendar data entry point and request contract are agreed. Valid sessions exist for ATTENDEE-A and ORGANISER-A.                                                                                                                                                                                                                                  |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Authenticate as variant A and send a valid availability request directly to the calendar data entry point, without loading the page.<br>2. Inspect the HTTP status and response body.<br>3. Repeat with variant B in a separate authenticated session.<br>4. Record the endpoint, sanitised request and response status for each run; exclude session tokens. |
| Test Data           | Specific inputs used to conduct the test       | Variants A=ATTENDEE-A and B=ORGANISER-A. Valid calendar request: Venue A and R1. Request method and endpoint are recorded when the server-function contract is finalised.                                                                                                                                                                                        |
| Expected Result     | Expected result from the test                  | Both requests are refused with 403 Forbidden under the repository’s authorisation convention. The response contains no availability, booking or blocked-period data. AC5 requires refusal; the specific HTTP mapping follows the existing auth contract.                                                                                                         |
| Planned Test Level  | Where the behaviour will be verified           | Integration                                                                                                                                                                                                                                                                                                                                                      |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                                                                                  |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                                                                                |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                      |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                        |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC14-A and PTR-28-TC14-B. The assertion must reach the actual server entry point, not only a mocked permission helper. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                        |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                        |

### PTR-28-TC15

**Invalid calendar input is rejected clearly**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC15                                                                                                                                                                                                                                                                                                             |
| Acceptance Criteria | Criterion addressed and type of coverage       | Supports AC1 — proposed validation coverage                                                                                                                                                                                                                                                                             |
| Test Scenario       | Succinct objective of the test case            | Invalid calendar input is rejected clearly.                                                                                                                                                                                                                                                                             |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is authenticated. The request schema is agreed and the valid Venue A/R1 request succeeds as a control.                                                                                                                                                                                              |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Begin each variant from the valid Venue A/R1 request.<br>2. Replace only the input described for that variant.<br>3. Submit it through the validation boundary; where applicable submit the corresponding form.<br>4. Record the error and confirm no availability result is accepted. Reset input between variants. |
| Test Data           | Specific inputs used to conduct the test       | Variants: A=missing venue; B=nonexistent venue ID; C=start date 2026-99-99; D=end date earlier than start (07 October to 05 October 2026); E=missing one range endpoint.                                                                                                                                                |
| Expected Result     | Expected result from the test                  | Each invalid request is rejected with a clear, field-relevant message or agreed not-found response. No invalid range is queried and no fabricated available schedule is returned. Raw Zod issue objects or stack traces are not shown to the user.                                                                      |
| Planned Test Level  | Where the behaviour will be verified           | Unit and integration; browser for user-facing validation                                                                                                                                                                                                                                                                |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                                         |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                                       |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                                             |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                               |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC15-A through PTR-28-TC15-E. Detailed messages and error status mappings need agreement before these supporting assertions become mandatory. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                               |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                               |

### PTR-28-TC16

**A valid empty schedule displays available periods**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                       |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC16                                                                                                                                                                            |
| Acceptance Criteria | Criterion addressed and type of coverage       | Supports AC2 — derived availability coverage                                                                                                                                           |
| Test Scenario       | Succinct objective of the test case            | A valid empty schedule displays available periods.                                                                                                                                     |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Retain Venue A with 24-hour operating hours but remove all its bookings and blocks from this case’s isolated fixture. COORD-A is signed in.                                |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Prepare the empty-schedule fixture.<br>2. Request and display Venue A for R3.<br>3. Inspect the reader result and the calendar state across the selected day.                       |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3; empty booking and blocked-period collections; confirmed successful data response.                                                                                         |
| Expected Result     | Expected result from the test                  | The selected day is available, with no confirmed or blocked periods. The calendar does not confuse an existing venue with no occupancy records with a missing venue or failed request. |
| Planned Test Level  | Where the behaviour will be verified           | Unit integration and browser                                                                                                                                                           |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                        |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                      |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                           |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                             |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | This expectation uses a venue open all day. Availability outside real operating hours remains an explicit product decision. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                             |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                             |

### PTR-28-TC17

**A pending booking request is not displayed as confirmed**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC17                                                                                                                                                                                                           |
| Acceptance Criteria | Criterion addressed and type of coverage       | Supports AC2 and AC3 — booking-status interpretation                                                                                                                                                                  |
| Test Scenario       | Succinct objective of the test case            | A pending booking request is not displayed as confirmed.                                                                                                                                                              |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. P01 is pending and no approved booking or recorded block overlaps its period.                                                                                                                             |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Request Venue A’s availability for R3.<br>2. Inspect the status and occupancy for 16:00–17:00.<br>3. Confirm the approved B01 booking remains confirmed and U01 remains blocked.                                   |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R3; P01 pending for 05 October 2026 16:00–17:00. B01 and U01 remain as positive controls.                                                                                                                    |
| Expected Result     | Expected result from the test                  | P01 does not appear as a confirmed booking. Proposed policy: a pending request does not hold the venue, so 16:00–17:00 remains available in this fixture. The approved booking and block retain their correct states. |
| Planned Test Level  | Where the behaviour will be verified           | Unit and integration                                                                                                                                                                                                  |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                       |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                     |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                                                                               |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                                                                 |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Confirm the pending-request hold policy with the booking stories before asserting the Available outcome. The pending-versus-approved distinction must remain visible in the test specification. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                                                                 |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                                                                 |

### PTR-28-TC18

**Signed-out users cannot access calendar data**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC18                                                                                                                                                                                                                                                                                      |
| Acceptance Criteria | Criterion addressed and type of coverage       | Supports AC1 and AC5 — existing authentication boundary                                                                                                                                                                                                                                          |
| Test Scenario       | Succinct objective of the test case            | Signed-out users cannot access calendar data.                                                                                                                                                                                                                                                    |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. Use a fresh browser/API context with no session cookies or authorisation headers.                                                                                                                                                                                                    |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Variant A: navigate directly to the calendar page while signed out.<br>2. Inspect the final URL and ensure no calendar data is displayed.<br>3. Variant B: request Venue A/R1 directly from the data endpoint without a session.<br>4. Record the page result and direct response separately. |
| Test Data           | Specific inputs used to conduct the test       | Anonymous user; Venue A; R1; agreed calendar page and data endpoint.                                                                                                                                                                                                                             |
| Expected Result     | Expected result from the test                  | A: the page redirects to login and displays no availability data. B: the data request returns 401 Unauthorized without availability records. These outcomes follow the repository’s authentication convention.                                                                                   |
| Planned Test Level  | Where the behaviour will be verified           | Browser and integration                                                                                                                                                                                                                                                                          |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                                                  |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                                                |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                   |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                     |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Run IDs: PTR-28-TC18-A and PTR-28-TC18-B. AC5 explicitly concerns external roles; this additional case covers absence of a session. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                     |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                     |

### PTR-28-TC19

**A data retrieval failure is shown as an error**

#### Test case specification

| Item                | Description                                    | Test case record                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID        | Unique ID of the test case                     | PTR-28-TC19                                                                                                                                                                                                                                                       |
| Acceptance Criteria | Criterion addressed and type of coverage       | Supports AC1 and AC2 — proposed failure-state coverage                                                                                                                                                                                                            |
| Test Scenario       | Succinct objective of the test case            | A data retrieval failure is shown as an error.                                                                                                                                                                                                                    |
| Pre-conditions      | Conditions to fulfil before executing the test | P0 applies. COORD-A is signed in. Configure a test-only failure on the calendar data request, without stopping shared services.                                                                                                                                   |
| Test Steps          | Step-by-step procedure to execute the test     | 1. Make the next Venue A/R1 availability request fail through the test harness.<br>2. Open or refresh the calendar and inspect the error state.<br>3. Remove the injected failure.<br>4. Use the agreed retry or reload action and inspect the successful result. |
| Test Data           | Specific inputs used to conduct the test       | Venue A; R1; an intercepted availability request that returns a controlled server error. Retry uses the successful baseline response.                                                                                                                             |
| Expected Result     | Expected result from the test                  | The failed request displays an understandable error and does not render a false all-available schedule. After a successful retry or reload, the baseline availability is displayed.                                                                               |
| Planned Test Level  | Where the behaviour will be verified           | Unit or component and browser                                                                                                                                                                                                                                     |
| Created By*         | Author of the test case                        | Codex, prepared for Yuhan Huang                                                                                                                                                                                                                                   |
| Date of Creation*   | Date the test case was created                 | 12 September 2026                                                                                                                                                                                                                                                 |

#### Test execution record

| Item                           | Description                                                 | Execution record                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Result                  | Actual result from the test, completed after execution      | Not recorded. This case has not been executed.                                                                                                                                                                            |
| Pass/Fail/Not Executed/Blocked | Status of the test                                          | Not Executed                                                                                                                                                                                                              |
| Remarks                        | Comments, evidence, build/environment, variant and blockers | Record the injected error and recovery evidence. Exact retry UI is a design choice to agree; this is supporting coverage rather than a separate Linear acceptance criterion. Complete run-specific details when executed. |
| Executed By*                   | Person who ran the test                                     | Not recorded                                                                                                                                                                                                              |
| Date of Execution*             | Date the test case was run                                  | Not recorded                                                                                                                                                                                                              |

## Completion and review

Before implementation, review the case specifications, confirm the open decisions, and agree the fixture and endpoint contracts. The next coding step is to add test fixtures and automated tests that reference the IDs in this document.

After implementation, record outcomes for every case and variant. Preserve a separate execution entry for each automated level where a case spans unit, integration and browser coverage. AC coverage remains incomplete while any required direct case is unexecuted, blocked or failing.

Use descriptive automated test names, for example:

```text
[PTR-28-TC07][AC3] displays approved bookings belonging to another coordinator's event
```

Run relevant story tests and the repository's required regression checks, including the production build. Generate any required schema migrations with Drizzle Kit; this document neither defines nor applies migrations.

## Repository references

- [Development and testing guide](../DEVELOPMENT.md)
- [Architecture and authorisation](../ARCHITECTURE.md)
- [Contribution and verification requirements](../CONTRIBUTING.md)
- [Agent rules](../../AGENTS.md)
