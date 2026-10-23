---
date: 2026-10-23
adr-number: ADR-9
status: accepted
---

# ADR-9: UI redesign from the screenshot review

## Context

A screenshot review of every route found P1 and P2 usability defects. The defects cover mobile
navigation, venue availability, role dashboards, forms, venue discovery, auth, and empty states.
The same branch carries PTR-161, which maintains the room layout list.

The redesign must not add database columns, dependencies, or new authorization rules. It must keep
the PTR-161 behaviour and the existing test selectors where possible.

## Decision

- Fix the P1 findings and the P2 findings on surfaces that the redesign touches. The review report
  is `.scratch/ui-review/REPORT.md`; the work plan is `.scratch/ui-review/REDESIGN-PLAN.md`.
- Add shared primitives only where two or more features need them: `ListRow`, a `PageHeader` back
  slot, form error summary and sticky actions, a password input, role labels, and a dashboard view
  model.
- Keep role dashboards on list rows, as `docs/DESIGN.md` requires.
- Derive calendar closed days from the venue operating hours that the page already receives. Do not
  add a server field.
- Keep PTR-161 commits intact. Add redesign commits after the merge commit `e7df915`, so the work
  can be split later. Review the redesign delta from `e7df915`.
- Defer these items, with reasons in the plan: draft autosave, venue media fields, a cross-event
  task inbox, mandatory email verification, self-service role changes, past-booking filters,
  maintained layout labels on Organiser/Lead/Safety event pages, and Add to calendar.
- Add no new server function. The dashboard route composes existing server functions.

## Alternatives Considered

### Rewrite the application shell in one change

- Pros: one visual language from the first commit.
- Cons: a large diff with no reviewable boundary, and a high risk to PTR-161.
- Rejected: the redesign ships in workstreams with a file ownership matrix.

### Put the redesign on a new branch from `main`

- Pros: clean PTR-161 pull request.
- Cons: the branch would carry two large changes that must be rebased and tested twice.
- Rejected: keep the commits separated on `zekkv/ptr-161`; split later if needed.

### Change the global type scale

- Pros: one CSS change fixes every same-size heading pair.
- Cons: it changes every page and contradicts the current `display-h2` role.
- Rejected: section headings use `display-h3` at the call sites.

## Consequences

- The branch carries PTR-161 plus the redesign. The review context names both scopes.
- Screenshot evidence and the local Playwright config are development aids, not CI gates.
- The deferred items need separate tickets before they can ship.
