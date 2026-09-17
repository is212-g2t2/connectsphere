---
date: 2026-09-16
adr-number: ADR-3
status: accepted
---

# ADR-3: Deploy to Google Cloud Run in a single GCP project

## Context

ConnectSphere has to be deployed. It is built on Bun and uses Bun-native drivers: `bun:sql` through `drizzle-orm/bun-sql` for Postgres, `Bun.s3` for presigned uploads, and a `Bun.RedisClient` in `src/lib/redis.server.ts` that is wired but currently imported by nothing. [ADR-1](./ADR-1-tanstack-start.md) committed to those drivers and recorded the consequence: hosting must run the Bun runtime or the three drivers need replacing.

The deployment needs two environments, staging and production, sized for a peak of about 100 concurrent users in production, with a release process that can roll back and a configuration store the team can rotate without rebuilding images. The team already operates another application (localoco) on Cloud Run, with Terraform-owned service shells and a GitHub Actions stage → migrate → smoke → promote pipeline.

## Decision

Deploy to **Google Cloud Run** (`asia-southeast1`), with **one GCP project holding both environments**: two services (`connectsphere` and `connectsphere-staging`), one Cloudflare R2 bucket per environment, and a Supabase project per environment. Images are published to GHCR, the service shells are Terraform-owned in [`infra/`](../../infra/), secrets live in Secret Manager, and [`.github/workflows/release.yml`](../../.github/workflows/release.yml) stages each release at 0% traffic, migrates, smoke-tests the staged revision, and promotes it.

The trade this makes is the single project. Two projects is the textbook blast-radius answer, and it doubles the bootstrap, the state bucket, the WIF pool, and the ongoing drift surface. The isolation that actually matters (staging must not be able to read production's database credentials) is bought instead with a runtime service account per environment, each granted `secretmanager.secretAccessor` on only its own seven secrets, for about ten lines of Terraform. Revisit if a second team needs staging access that production should not grant, or if the residual risk below becomes real.

## Alternatives Considered

### Vercel / Netlify

- Pros: first-class DX for the frontend, previews per branch, managed TLS, zero container operations.
- Cons: serverless runtimes are Node-based, so the three Bun-native drivers would all need replacing: `drizzle-orm/bun-sql` for a Postgres driver, `Bun.s3` for the AWS SDK or a storage service, `Bun.RedisClient` for an HTTP-based cache. TanStack Start on Vercel also means adapting the Nitro build to the platform.
- Rejected: rewriting the data layer to fit a hosting platform is the opposite of the ADR-1 decision. The drivers are the constraint; the platform must run them.

### Railway / Fly.io / Render

- Pros: run the container as-is, no driver changes, far less infrastructure to own than GCP.
- Cons: no GCP-native Workload Identity Federation, so GitHub Actions would authenticate with long-lived provider credentials; secrets would live in the provider's store, outside the Secret Manager pattern in use; and the team would run deployment orchestration the localoco pattern already solves.
- Rejected: viable, but it loses on the two things the pipeline actually needs (keyless CI authentication and a managed secret store) and diverges from the operating model already proven in localoco.

### Compute Engine VM

- Pros: run anything, the cheapest raw compute, no scheduling constraints.
- Cons: we would own OS patching, TLS certificates, instance sizing, and the rollout mechanism; a single VM is also a single point of failure that Cloud Run's revisions and autoscaling are not.
- Rejected: the operational surface is larger than the application justifies, and nothing here needs a long-lived machine.

### Kubernetes (GKE)

- Pros: portable, fine-grained rollout control, strong separation between environments.
- Cons: a cluster to operate, upgrade, and secure for one service with two environments; the rollout control Cloud Run already gives through revisions and traffic splits.
- Rejected: not justified at this size.

## Consequences

- **Additive-only migrations are mandatory.** Staged and serving revisions share one database: `migrate` runs after the new revision is staged at 0% and before promotion, so the old revision serves live traffic against the migrated schema. Dropping or renaming a column, or adding a constraint the old code can violate, must be expanded and contracted across separate releases. Nothing enforces this mechanically; it is a review rule, and it is what makes both promotion and traffic-only rollback safe.
- **Rollback moves traffic, not schema.** Cloud Run retains revisions, so `rollback.yml` restores a previous revision instantly, but a rollback after a breaking migration runs old code against the new schema.
- **One image serves both environments.** All baked `VITE_*` values are identical; the browser's Sentry environment is derived from the hostname at runtime. That is what allows a fast-forwarded `staging` → `main` merge to promote the exact digest staging tested rather than a rebuild.
- **Bun is a hard runtime requirement.** Moving to a non-Bun platform later means replacing all three drivers, not reconfiguring a build.
- **Residual risk from the single project:** the deploy service account holds project-wide `run.admin` and can act as either runtime account, so a workflow running from `staging` can deploy to the production service (and thereby run as `cs-prod-run` with access to production's secrets), not merely move production traffic. Per-environment deploy identities are the fix if this needs closing.
- **One state file** covers both environments.
