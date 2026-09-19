---
date: 2026-09-19
adr-number: ADR-4
status: accepted
---

# ADR-4: Trunk-based `main` with release-gated production

## Context

[ADR-3](./ADR-3-cloud-run.md) chose a two-branch model: feature work merged to `staging`, `staging` promoted to `main` fast-forward only, and every push to either branch deployed that environment. Fast-forward promotion kept the deployed artifact identical between environments: the `main` push reused the digest `staging` had already built and tested.

Automating versions with release-please needs a commit on the release branch (the version bump in `package.json` and the manifest). A bot commit cannot reach `main` under a fast-forward-only rule without a back-merge to `staging` on every release, and a release PR targeting `main` would itself be the divergence. Deploying production on every push also ties production deploys to merge cadence, with no deliberate release act and no version attached to what production runs.

## Decision

Make `main` the only long-lived branch, and separate deployment from release:

- A push to `main` runs the five check suites and deploys staging ([`deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)).
- [`release-please.yml`](../../.github/workflows/release-please.yml) maintains a release PR against `main` from Conventional Commits. Merging it bumps `package.json` and `.release-please-manifest.json` and publishes a tagged GitHub Release.
- The published release deploys production ([`deploy-production.yml`](../../.github/workflows/deploy-production.yml)) through the same stage → migrate → smoke → promote pipeline, shared in [`deploy.yml`](../../.github/workflows/deploy.yml).

The release commit is itself a push to `main`, so the staging deploy builds its image; the production pipeline waits for that digest and promotes it after its own stage, migrate and smoke steps, preserving ADR-3's one-image property without the fast-forward rule.

## Alternatives Considered

### Keep the two-branch model and target release-please at `staging`

- Pros: no change to the branch contract; production stays a push to `main`.
- Cons: release commits would reach `main` only through promotion, so cutting a release and deploying production would stay the same act, and production would still deploy on every promotion. `main` would keep a permanent fast-forward-only rule that also blocks hotfixes and bot commits.
- Rejected: the fast-forward rule is the constraint that costs the most and buys the image identity, which the release-tag pipeline provides more directly.

### Keep the two-branch model and target release-please at `main`

- Pros: standard release-please setup.
- Cons: every release commit lands on `main` outside `staging`, so the next fast-forward promotion fails until `main` is merged back, and the digest-reuse property breaks for that commit.
- Rejected: it breaks the branch contract the deployment depends on.

### Production on `workflow_dispatch`

- Pros: the most explicit release act; a later deploy avoids waiting for the staging build.
- Cons: deploys can drift from releases unless the dispatch validates a tag, and the release PR merge plus the dispatch makes two manual steps for one release.
- Rejected: a published release is already a deliberate, versioned, reviewable act, and it can be re-run from the Actions tab when a deployment fails.

## Consequences

- Staging serves `main` HEAD; production serves a tagged ancestor. The release commit ran on staging when it was pushed, but staging may be several commits ahead by release time.
- Staging migrates on every push to `main`, production per release, so the additive-only expand/contract rule now spans the gap between releases.
- Production runs no check suites of its own; the tagged commit passed on its PR and its push. The production pipeline still stages at 0% traffic, migrates, smoke-tests and promotes.
- A failed production deploy is recovered by re-running the release-triggered workflow, which reuses the same tagged commit.
- ADR-3's fast-forward-specific consequence is superseded; its one-image property, additive-only migration rule and traffic-only rollback stand.
