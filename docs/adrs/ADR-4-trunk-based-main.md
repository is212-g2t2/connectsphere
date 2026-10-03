---
date: 2026-09-19
adr-number: ADR-4
status: accepted
---

# ADR-4: Trunk-based `main` with release-gated production

## Context

[ADR-3](./ADR-3-cloud-run.md) chose a two-branch model: feature work merged to `staging`, `staging` promoted to `main` fast-forward only, and every push to either branch deployed that environment. Fast-forward promotion kept the deployed artifact identical between environments: the `main` push reused the digest that `staging` had already built and tested.

Automating versions with release-please needs a commit on the release branch (the version bump in `package.json` and the manifest). A bot commit cannot reach `main` under a fast-forward-only rule without a back-merge to `staging` on every release. A release PR against `main` is itself the divergence. A production deploy on every push also ties production deploys to the merge cadence. That model has no deliberate release act, and production runs without a version.

## Decision

Use `main` as the only long-lived branch and separate deployment from release:

- A push to `main` runs the five check suites and deploys staging ([`deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)).
- [`release-please.yml`](../../.github/workflows/release-please.yml) maintains a release PR against `main` from Conventional Commits. A merge of that PR bumps `package.json` and `.release-please-manifest.json` and publishes a tagged GitHub Release.
- The published release deploys production ([`deploy-production.yml`](../../.github/workflows/deploy-production.yml)) through the same stage → migrate → smoke → promote pipeline, shared in [`deploy.yml`](../../.github/workflows/deploy.yml).

The release commit is itself a push to `main`, so the staging deploy builds its image. The production pipeline waits for that digest and promotes it after its own stage, migrate and smoke steps. This design preserves ADR-3's one-image property without the fast-forward rule.

## Alternatives Considered

### Keep the two-branch model and target release-please at `staging`

- Pros: no change to the branch contract; production stays a push to `main`.
- Cons: release commits reach `main` only through promotion. A release therefore cannot happen without a production deploy, and production still deploys on every promotion. `main` keeps a permanent fast-forward-only rule that also blocks hotfixes and bot commits.
- Rejected: the fast-forward rule is the constraint with the highest cost. It buys the image identity, but the release-tag pipeline provides that identity more directly.

### Keep the two-branch model and target release-please at `main`

- Pros: standard release-please setup.
- Cons: every release commit goes to `main` outside `staging`. The next fast-forward promotion then fails until `main` is merged back, and the digest-reuse property breaks for that commit.
- Rejected: it breaks the branch contract that the deployment depends on.

### Production on `workflow_dispatch`

- Pros: the most explicit release act; a later deploy avoids waiting for the staging build.
- Cons: deploys can drift from releases unless the dispatch validates a tag. The release PR merge and the dispatch also make two manual steps for one release.
- Rejected: a published release is already a deliberate, versioned, and reviewable act. The team can re-run it from the Actions tab when a deployment fails.

## Consequences

- Staging serves `main` HEAD. Production serves a tagged ancestor. The release commit ran on staging when it was pushed, but staging can be several commits ahead by release time.
- Staging migrates on every push to `main`, and production migrates per release. The additive-only expand/contract rule therefore spans the gap between releases.
- Production runs no check suites of its own. The tagged commit passed its checks on the PR and the push. The production pipeline still stages at 0% traffic, migrates, smoke-tests, and promotes.
- To recover a failed production deploy, re-run the release-triggered workflow. It reuses the same tagged commit.
- ADR-4 supersedes the fast-forward-specific consequence in ADR-3. The one-image property, the additive-only migration rule, and the traffic-only rollback stand.
