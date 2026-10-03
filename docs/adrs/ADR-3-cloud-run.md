---
date: 2026-09-16
adr-number: ADR-3
status: accepted
---

# ADR-3: Deploy to Google Cloud Run in a single GCP project

> **Amended 2026-10-04:** the upload demo and its Cloudflare R2 buckets, `Bun.s3` usage and two R2 secrets were removed (PTR-121). Secret Manager now holds six secrets per environment. The Cloud Run decision and the single-project trade stand.

## Context

ConnectSphere must be deployed. The application uses Bun for the build and the runtime. It uses Bun-native drivers. It uses `bun:sql` through `drizzle-orm/bun-sql` for PostgreSQL and `Bun.s3` for presigned uploads. A `Bun.RedisClient` in `src/lib/redis.server.ts` is wired, but nothing imports it yet. [ADR-1](./ADR-1-tanstack-start.md) committed to those drivers and recorded the consequence: hosting must run the Bun runtime, or the team must replace the three drivers.

The deployment needs two environments, staging and production. Production must handle a peak of about 100 concurrent users. The team needs a release process that can roll back and a configuration store with values that the team can rotate without rebuilding images. The team already operates another application (localoco) on Cloud Run. That application has Terraform-owned service shells and a GitHub Actions stage → migrate → smoke → promote pipeline.

## Decision

Deploy to **Google Cloud Run** (`asia-southeast1`) with **one Google Cloud project for both environments**. The project holds two services (`connectsphere` and `connectsphere-staging`), one Cloudflare R2 bucket per environment, and one Supabase project per environment. The team publishes images to the GitHub Container Registry (GHCR). Terraform owns the service shells in [`infra/`](../../infra/), and secrets live in Secret Manager. [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) stages each release at 0% traffic, migrates, smoke-tests the staged revision, and promotes it.

This decision accepts one project instead of two. Two projects is the standard answer for blast-radius isolation. It doubles the bootstrap, the state bucket, the workload identity federation (WIF) pool, and the ongoing drift surface. The team buys the isolation that matters instead (staging must not read production's database credentials) with a runtime service account per environment. Each account is granted `secretmanager.secretAccessor` on only its own eight secrets, for about ten lines of Terraform. Revisit this decision if a second team needs staging access that production must not grant, or if the residual risk below becomes real.

## Alternatives Considered

### Vercel / Netlify

- Pros: first-class developer experience for the frontend, previews per branch, managed transport layer security (TLS), zero container operations.
- Cons: serverless runtimes are Node-based. TanStack Start on Vercel also needs an adaptation of the Nitro build. All three Bun-native drivers need a replacement:
  - a PostgreSQL driver for `drizzle-orm/bun-sql`
  - the AWS SDK or a storage service for `Bun.s3`
  - an HTTP-based cache for `Bun.RedisClient`
- Rejected: the team must not rewrite the data layer to fit a hosting platform. That contradicts the ADR-1 decision. The drivers are the constraint, so the platform must run them.

### Railway / Fly.io / Render

- Pros: the provider runs the container as supplied, no driver changes, and far less infrastructure to own than Google Cloud.
- Cons: the provider has no Google Cloud-native workload identity federation, so GitHub Actions authenticates with long-lived provider credentials. Secrets live in the provider's store, outside the Secret Manager pattern in use. The team must also operate the deployment orchestration that the localoco pattern already solves.
- Rejected: the option is viable, but it loses on the two things that the pipeline needs. These are keyless authentication from continuous integration (CI) and a managed secret store. It also diverges from the operating model that localoco already proves.

### Compute Engine VM

- Pros: run anything, the cheapest raw compute, no scheduling constraints.
- Cons: the team must own OS patching, TLS certificates, instance sizing, and the rollout mechanism. A single VM is also a single point of failure that Cloud Run revisions and autoscaling do not have.
- Rejected: the operational surface is larger than the application justifies, and nothing here needs a long-lived machine.

### Kubernetes (GKE)

- Pros: portable, fine-grained rollout control, strong separation between environments.
- Cons: a cluster to operate, upgrade, and secure for one service with two environments. Cloud Run already gives the rollout control through revisions and traffic splits.
- Rejected: not justified at this size.

## Consequences

- **Additive-only migrations are mandatory.** The staged revision and the serving revision share one database. `migrate` runs after the new revision is staged at 0% and before promotion, so the old revision serves live traffic against the migrated schema. The team must not drop or rename a column in the release that stops using it. The team must not add a constraint that the old code can violate in the same release. Expand the change in one release, then contract it in the next. Nothing enforces this rule mechanically. It is a review rule, and it makes both promotion and traffic-only rollback safe.
- **Rollback moves traffic, not schema.** Cloud Run retains revisions, so `rollback.yml` restores a previous revision immediately. However, a rollback after a breaking migration runs old code against the new schema.
- **One image serves both environments.** All baked `VITE_*` values are identical, and the browser derives the Sentry environment from the hostname at runtime. This property lets a fast-forwarded `staging` → `main` merge promote the exact digest that staging tested, with no rebuild. (ADR-4 supersedes the fast-forward rule; the one-image property stands.)
- **Bun is a hard runtime requirement.** To move to a non-Bun platform later, the team must replace all three drivers, not reconfigure a build.
- **Residual risk from the single project:** the deploy service account holds project-wide `run.admin` and can act as either runtime account. The staging deploy workflow can therefore deploy to the production service, and it can run as `cs-prod-run` with access to production's secrets. It is not limited to moving production traffic. Per-environment deploy identities are the fix if this risk needs closing.
- **One state file** covers both environments.
