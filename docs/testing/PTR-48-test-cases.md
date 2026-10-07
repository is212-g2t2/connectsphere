# PTR-48 test cases: see who has registered for my event

**Story:** As an Event Organiser, I want to see who has registered for my event so that I can see the list of attendees.

**Source:** PTR-48
**Branch:** yuhanhuang2024/ptr-48
**Baseline commit:** 44a07500782e33e63eb8d820644ff96578a3c6a5
**Document version:** 1.0
**Created:** 7 October 2026
**Prepared by:** Antigravity, for Yuhan Huang

At document creation, all cases are **Not Executed**. The cases were written before the implementation (test-first).

## How to use the records

Each case has two tables. The **test case specification** defines the case and does not change between runs. Complete a new **test execution record** for each run. Do not overwrite an earlier record.

Fields marked with an asterisk are optional metadata. Keep the case ID stable. For a case with variants, record each variant separately with its suffix (for example PTR-48-TC05-A).

| Execution status | Meaning                                                                       |
| :--------------- | :---------------------------------------------------------------------------- |
| Pass             | The actual result precisely matched the expected result.                      |
| Fail             | The actual result differed from the expected result in a material way.        |
| Not Executed     | The test has not been run.                                                    |
| Blocked          | A defect or environment failure prevents this test from running or finishing. |

---

## PTR-48-TC01

**Test case specification**

| Item               | Test case record                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Test Case ID       | PTR-48-TC01                                                                                                 |
| Test Scenario      | The event organiser and the assigned coordinator can view the attendee list.                                |
| Pre-conditions     | An event exists with 3 active registrations (2 normal, 1 VIP).                                              |
| Test Steps         | A: Call the list endpoint as the event organiser.<br>B: Call the list endpoint as the assigned coordinator. |
| Test Data          | Event ID 101, user is organiser or assigned coordinator.                                                    |
| Expected Result    | 200 OK. The returned list contains exactly 3 attendees, with their names, emails, and VIP status.           |
| Created By\*       | Antigravity, for Yuhan Huang                                                                                |
| Date of Creation\* | 7 October 2026                                                                                              |

**Test execution record**

| Item                                 | Execution record                               |
| ------------------------------------ | ---------------------------------------------- |
| Actual Result                        | Not recorded. This case has not been executed. |
| Pass / Fail / Not Executed / Blocked | Not Executed                                   |
| Remarks                              | None.                                          |
| Executed By\*                        | Not recorded                                   |
| Date of Execution\*                  | Not recorded                                   |

---

## PTR-48-TC02

**Test case specification**

| Item               | Test case record                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Test Case ID       | PTR-48-TC02                                                                                             |
| Test Scenario      | The list excludes withdrawn registrations and shows VIP tags correctly.                                 |
| Pre-conditions     | An event has 4 registrations: 1 active normal, 1 active VIP, 1 withdrawn normal, 1 withdrawn VIP.       |
| Test Steps         | Call the list endpoint as the event organiser.                                                          |
| Test Data          | Event ID 101.                                                                                           |
| Expected Result    | 200 OK. The list contains exactly 2 attendees (1 normal, 1 VIP). The withdrawn attendees do not appear. |
| Created By\*       | Antigravity, for Yuhan Huang                                                                            |
| Date of Creation\* | 7 October 2026                                                                                          |

**Test execution record**

| Item                                 | Execution record                               |
| ------------------------------------ | ---------------------------------------------- |
| Actual Result                        | Not recorded. This case has not been executed. |
| Pass / Fail / Not Executed / Blocked | Not Executed                                   |
| Remarks                              | None.                                          |
| Executed By\*                        | Not recorded                                   |
| Date of Execution\*                  | Not recorded                                   |

---

## PTR-48-TC03

**Test case specification**

| Item               | Test case record                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Test Case ID       | PTR-48-TC03                                                                                                   |
| Test Scenario      | The endpoint refuses access to unauthorised users.                                                            |
| Pre-conditions     | An event exists.                                                                                              |
| Test Steps         | A: Call as an unassigned coordinator.<br>B: Call as a different organiser.<br>C: Call as a standard attendee. |
| Test Data          | Event ID 101. Users without the correct permission mapping.                                                   |
| Expected Result    | 403 Forbidden (or AuthorizationError) in all three cases. The list is not returned.                           |
| Created By\*       | Antigravity, for Yuhan Huang                                                                                  |
| Date of Creation\* | 7 October 2026                                                                                                |

**Test execution record**

| Item                                 | Execution record                               |
| ------------------------------------ | ---------------------------------------------- |
| Actual Result                        | Not recorded. This case has not been executed. |
| Pass / Fail / Not Executed / Blocked | Not Executed                                   |
| Remarks                              | None.                                          |
| Executed By\*                        | Not recorded                                   |
| Date of Execution\*                  | Not recorded                                   |

---

## PTR-48-TC04

**Test case specification**

| Item                                                                              | Test case record                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Case ID                                                                      | PTR-48-TC04                                                                                                                                 |
| Test Scenario                                                                     | The event list (handleListEvents) projection exposes places counts correctly (including VIP separate count) to Organisers and Coordinators. |
| Pre-conditions                                                                    | An event has 2 normal registrations and 1 VIP registration.                                                                                 |
| Test Steps                                                                        | A: Fetch the event projection as the Organiser.<br>B: Withdraw a registration and fetch the projection again.                               |
| Test Data                                                                         | Event ID 101.                                                                                                                               |
| Expected Result                                                                   | A: places object has                                                                                                                        |
| egistered: 2 and ip: 1.<br>B: The count reflects the withdrawal immediately (e.g. |
| egistered: 1).                                                                    |
| Created By\*                                                                      | Antigravity, for Yuhan Huang                                                                                                                |
| Date of Creation\*                                                                | 7 October 2026                                                                                                                              |

**Test execution record**

| Item                                 | Execution record                               |
| ------------------------------------ | ---------------------------------------------- |
| Actual Result                        | Not recorded. This case has not been executed. |
| Pass / Fail / Not Executed / Blocked | Not Executed                                   |
| Remarks                              | None.                                          |
| Executed By\*                        | Not recorded                                   |
| Date of Execution\*                  | Not recorded                                   |
