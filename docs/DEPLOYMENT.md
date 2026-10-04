# Deployment

ConnectSphere runs on **Google Cloud Run** in two environments: staging at `connectsphere-staging.ciav.dev` from `main`, and production at `connectsphere.ciav.dev` from a published release. Supabase PostgreSQL, Cloudflare R2 storage, and Cloudflare DNS and web application firewall (WAF) back both environments. The reasoning behind the target is in [ADR-3](./adrs/ADR-3-cloud-run.md). The Terraform that builds it is in [`infra/`](../infra/), with the bootstrap order and the manual steps in [`infra/README.md`](../infra/README.md).

This document covers the deployed topology, the release pipeline, the configuration, and rollback. The [local Docker workflow](#what-runs-where) follows at the end, and it remains the only way to run the whole stack on a laptop.

## Topology

![Deployment topology: the Cloudflare edge fronts the two Cloud Run services, which use Supabase PostgreSQL, Cloudflare R2, Secret Manager, Resend, and Sentry; GitHub Actions deploys the image through GHCR](./diagrams/deployment-topology.svg)

Source: [`deployment-topology.drawio`](./diagrams/deployment-topology.drawio).

|                      | Production                                                | Staging                                                      |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Hostname             | `connectsphere.ciav.dev`                                  | `connectsphere-staging.ciav.dev`                             |
| Cloud Run service    | `connectsphere`                                           | `connectsphere-staging`                                      |
| Runtime identity     | `cs-prod-run@connectsphere-is212.iam.gserviceaccount.com` | `cs-staging-run@connectsphere-is212.iam.gserviceaccount.com` |
| Instances (min–max)  | 0–5                                                       | 0–2                                                          |
| R2 bucket            | `connectsphere-uploads`                                   | `connectsphere-staging-uploads`                              |
| Sentry `environment` | `production`                                              | `staging`                                                    |

Both environments live in **one Google Cloud project**, and a runtime service account per environment keeps staging out of production's credentials ([ADR-3](./adrs/ADR-3-cloud-run.md#consequences)).

Both services scale to zero, so the first request after an idle period pays the cold start (Bun boot plus Nitro initialization), softened by `startup_cpu_boost`. Every revision must pass a startup probe on `GET /api/health` before it receives traffic. The probe is an HTTP check, not a TCP check, so traffic never reaches a process that has not finished booting.

`GET /api/health` is unauthenticated, and it deliberately does not touch the database. `GET /api/smoke` is the release gate: it requires `Authorization: Bearer $SMOKE_TOKEN`, runs `select 1`, and returns the Cloud Run revision that served it. An unset `SMOKE_TOKEN` answers 401.

## Releases

`main` is the only long-lived branch. A push to `main` runs [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml), which builds the image and deploys `connectsphere-staging`. Production deploys from a GitHub Release: [`deploy-production.yml`](../.github/workflows/deploy-production.yml) reacts to a published release and runs the same pipeline for `connectsphere`.

| Event             | Deploys    | GitHub Environment | Service                 |
| ----------------- | ---------- | ------------------ | ----------------------- |
| push to `main`    | staging    | `staging`          | `connectsphere-staging` |
| release published | production | `production`       | `connectsphere`         |

[`release-please.yml`](../.github/workflows/release-please.yml) runs on every push to `main` and maintains a release PR against `main` from the Conventional Commits. A merge of that PR is the release act: it bumps `package.json` and `.release-please-manifest.json`, tags the merge commit, and publishes the GitHub Release. Release notes come from the commits. The root [`CHANGELOG.md`](../CHANGELOG.md) stays hand-curated (`skip-changelog` in [`release-please-config.json`](../release-please-config.json)).

The production pipeline deploys the digest that the staging deploy of that commit builds, and it waits up to 30 minutes for the digest. It does not rebuild the image or repeat the checks. If staging never publishes the image, the production run fails after the wait. Re-run the staging deploy for that commit, then run the production deploy. A staging failure after publish does not stop production: its own stage, migrate, and smoke steps gate the revision. [ADR-4](./adrs/ADR-4-trunk-based-main.md) records why.

A docs-only change (`**.md`, `docs/**`) does not trigger a staging deploy. If the `production` environment has required reviewers, a release pauses after `deploy-stage` and before `migrate`. An approval releases the migration against the production database.

The staging workflow starts the deploy pipeline only after the five check workflows pass (code quality, unit, integration, E2E, and security). A release does not repeat the checks. Both call [`deploy.yml`](../.github/workflows/deploy.yml), which then:

| Stage          | What it does                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publish`      | Resolves `ghcr.io/is212-g2t2/connectsphere:sha-<commit>`. A staging deploy builds and pushes the image when it is missing. A release waits for the staging build of the tagged commit and deploys that **digest**. |
| `deploy-stage` | Authenticates with workload identity federation, records the revision that currently serves traffic, and deploys the image at **0% traffic** with the `staged` tag.                                                |
| `migrate`      | Runs `bunx drizzle-kit migrate` against the environment's session-pooler URL, from the exact commit (`actions/checkout` pinned to `github.sha`).                                                                   |
| `smoke`        | Reads `<env>-SMOKE_TOKEN`, calls `/api/health` and then `/api/smoke` on the staged tag URL. Fails unless the revision in the response is the revision that was just staged.                                        |
| `promote`      | Moves 100% of traffic to the staged revision and records the image digest, the active revision, and the previous revision in the run summary.                                                                      |
| `cleanup`      | On a failure after staging, removes the `staged` tag. A tag removal never moves traffic, so this step is safe even after a partial promote.                                                                        |

A failure after `migrate` leaves the migration applied. `cleanup` drops only the tag, and traffic can already have moved if `promote` failed late. Recovery is fix-forward or a code rollback, never a manual revert of the SQL.

## Configuration

### Secrets

Secret Manager holds sixteen containers: eight names under each environment prefix. The Cloud Run container sees the bare name, and the prefix is a Secret Manager naming concern. Values never enter the Terraform state or a tfvars file. Operators add versions with `gcloud`.

| Secret (`<env>-…`)                      | Purpose                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                          | Supabase **transaction pooler** (`:6543`) URL, used by the application with `prepare: false`          |
| `BETTER_AUTH_SECRET`                    | `openssl rand -base64 48`. Distinct per environment.                                                  |
| `SMOKE_TOKEN`                           | `openssl rand -hex 32`. Distinct per environment, read by the `smoke` job.                            |
| `CRON_TOKEN`                            | `openssl rand -hex 32`. Distinct per environment. The notification worker's bearer (PTR-55).          |
| `VITE_SENTRY_DSN`                       | Sentry DSN: a build arg for the browser bundle and a runtime environment variable for the server SDK. |
| `RESEND_API_KEY`                        | Transactional email.                                                                                  |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | R2 API token scoped to that environment's bucket.                                                     |

Create a `CRON_TOKEN` version in **both** environments before you deploy a revision that references it. A Cloud Run revision that mounts a versionless secret never becomes ready. Install the real header of the Cloud Scheduler job after the first apply. See [`infra/README.md`](../infra/README.md#notification-email-worker).

Add or rotate a version:

```bash
gcloud secrets versions add prod-BETTER_AUTH_SECRET \
  --project=connectsphere-is212 --data-file=-
```

Cloud Run resolves `latest` when an instance starts, so a rotated value reaches new instances. Deploy a new revision to cycle the running instances.

The GitHub side:

| Name                                                       | Kind                                         | Holds                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GCP_WIF_PROVIDER`                                         | repo secret                                  | Workload identity provider resource name (`terraform output wif_provider`)                                                                                                                                                                    |
| `GCP_SA`                                                   | repo secret                                  | Deploy service account email (`terraform output deploy_sa`)                                                                                                                                                                                   |
| `RELEASE_PLEASE_TOKEN`                                     | repo secret                                  | Fine-grained personal access token (PAT) that opens the release PR (Contents, Pull requests and Issues: read and write). The default token cannot open PRs here, and a PR that it opened does not run CI. Rotate the token before it expires. |
| `SENTRY_AUTH_TOKEN`                                        | repo secret                                  | Source-map upload. Passed to the build as a BuildKit secret.                                                                                                                                                                                  |
| `VITE_SENTRY_DSN`                                          | repo secret                                  | Build arg.                                                                                                                                                                                                                                    |
| `VITE_SENTRY_ORG`, `VITE_SENTRY_PROJECT`, `VITE_APP_TITLE` | repo variables                               | Build args.                                                                                                                                                                                                                                   |
| `DATABASE_URL_SESSION`                                     | environment secret (`staging`, `production`) | Session pooler (`:5432`) URL, used only by `migrate`.                                                                                                                                                                                         |

The WIF binding in [`infra/iam.tf`](../infra/iam.tf) admits only the `main` branch and `v*` release tags, so a pull-request workflow cannot assume the deploy identity. Terraform owns the binding. Apply `infra/` after you change it.

### Plaintext environment

| Variable                        | Production                                                     | Staging                                  |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `BETTER_AUTH_URL`, `SERVER_URL` | `https://connectsphere.ciav.dev`                               | `https://connectsphere-staging.ciav.dev` |
| `SENTRY_ENVIRONMENT`            | `production`                                                   | `staging`                                |
| `EMAIL_FROM`                    | `onboarding@resend.dev` until `ciav.dev` is verified in Resend | same                                     |
| `MINIO_ENDPOINT`                | R2 S3 endpoint (shared)                                        | same account, different bucket           |
| `MINIO_BUCKET`                  | `connectsphere-uploads`                                        | `connectsphere-staging-uploads`          |

`BETTER_AUTH_URL` must equal the environment's public origin. Better Auth derives its trusted origins from that value, and there is no `trustedOrigins` override. With a wrong value, the application still boots, but it produces broken verification links and cookie-domain mismatches instead of an error.

### Notification email worker

Cloud Scheduler (`<env>-notification-emails`, Terraform-owned in [`infra/scheduler.tf`](../infra/scheduler.tf)) sends a POST to the environment's Cloud Run URL `/api/cron/notifications` every minute, with the `CRON_TOKEN` bearer. The route claims up to 50 pending notification emails, sends them, and answers `{sent, failed, pending}`. `failed` counts the failures of this run. Rows retry with backoff and dead-letter after ten attempts. Dead-letter rows stay visible in the application's notifications page either way.

The route logs a rejected bearer as a warning. A scheduler header that stays as the placeholder shows in the Cloud Run logs. Create `<env>-CRON_TOKEN` versions before the next deploy. A revision that references a versionless secret never becomes ready.

Drain the queue by hand (staging shown; the token is a secret version and is never stored here):

```bash
TOKEN="$(gcloud secrets versions access latest --secret=staging-CRON_TOKEN --project=connectsphere-is212)"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  https://connectsphere-staging.ciav.dev/api/cron/notifications
```

Examine the dead-letter rows first:

```sql
select id, kind, recipient_id, email_attempts, last_email_error, created_at
from notifications
where emailed_at is null and failed_at is not null
order by created_at;
```

The every-minute wake pays a cold start on a scale-to-zero service. If that cost exceeds the notification latency, widen the schedule in `scheduler.tf` to `*/5 * * * *`. No code assumes a cadence.

### Deployed migrations

`migrate` runs after the new revision is staged at 0% traffic and before promotion. During that window, the previously serving revision handles live traffic against the migrated database. **Migrations must be additive-only.** Never drop or rename a column in the same release that stops using it. Never add a constraint that the old revision's writes can violate. Expand in one release, and contract in the next. Staging migrates on every push to `main`, and production migrates per release, so staging can be several migrations ahead. The rule spans that gap. Nothing enforces the rule mechanically. It is a review rule, and it makes the promote and rollback paths safe.

## Rollback and incidents

Rollback never rebuilds an artifact and never touches the database. It moves traffic back to a retained Cloud Run revision, and Cloud Run retains previous revisions automatically.

1. Find the revision to restore. Each release's run summary records the previous revision. If the summary does not have it, list the revisions:

   ```bash
   gcloud run revisions list --service=connectsphere \
     --region=asia-southeast1 --project=connectsphere-is212
   ```

2. Run **Rollback Cloud Run traffic** ([`rollback.yml`](../.github/workflows/rollback.yml)) from the Actions tab, and choose the service and the retained revision. For the production service, the run executes in the `production` GitHub Environment, so a required-reviewer rule there applies before traffic moves. Rollback shares the deploy's concurrency group (`deploy-staging` or `deploy-production`). If that deploy is in progress or waits on an approval, cancel it first: it holds the lock, and the rollback waits behind it.

3. Verify before you stand down:

   ```bash
   curl -fsS https://connectsphere.ciav.dev/api/health
   SMOKE_TOKEN="$(gcloud secrets versions access latest \
     --secret=prod-SMOKE_TOKEN --project=connectsphere-is212)"
   curl -fsS -H "Authorization: Bearer $SMOKE_TOKEN" https://connectsphere.ciav.dev/api/smoke
   ```

   The `revision` in the second response must be the revision that traffic was moved to.

**Rollback is traffic-only.** Nothing reverses the migrations, so a rollback after a breaking schema change runs old code against the new schema.

Rehearse the path on staging before you need it in production. Roll `connectsphere-staging` back to the previous revision, confirm that traffic moves, then roll forward.

## What runs where

`docker-compose.yaml` (compose project `connectsphere`) defines five services:

| Service         | Port       | Data                | Notes                                                       |
| --------------- | ---------- | ------------------- | ----------------------------------------------------------- |
| `postgres`      | 5432       | `./data/postgres`   | PostgreSQL 18, database `app`, user/password `postgres`     |
| `minio`         | 9000, 9001 | `./data/minio/data` | S3-compatible storage. Console on 9001, `admin`/`password`. |
| `minio_init`    | —          | —                   | Runs once to create the `app` bucket, then exits.           |
| `redis`         | 6379       | —                   | Redis 7.                                                    |
| `connectsphere` | 3000       | —                   | The application itself, built from `Dockerfile`.            |

State lives in bind mounts under `./data`, not named volumes. If you delete that directory, the database and the object store reset. If you rename the compose project, nothing is orphaned.

## The normal loop: services in Docker, the application on the host

This is what [DEVELOPMENT.md](./DEVELOPMENT.md) assumes and what the test suites expect.

```bash
docker compose up -d postgres redis minio minio_init
bun run db:migrate
bun run dev
```

`.env.example` matches this shape: `DATABASE_URL` and `MINIO_ENDPOINT` point at `localhost`, which is correct when the application runs on the host.

> [!IMPORTANT]
> Start the `connectsphere` service only when you want the containerized application. It binds port 3000, and the E2E setup does not reuse a running server: it fails on the busy port before any test runs. Run `docker compose stop connectsphere` before `bun run test:e2e`.

## Running the whole stack in Docker

```bash
docker compose up -d
```

> [!WARNING]
> The `connectsphere` service loads `env_file: .env.example`, whose hostnames are `localhost`. Inside a container, `localhost` means the container itself, not the database. The application boots and serves the landing page and `/api/health`, but anything that touches PostgreSQL or MinIO fails. Override the two hostnames with compose service names before you rely on it:
>
> ```
> DATABASE_URL="postgresql://postgres:postgres@postgres:5432/app"
> MINIO_ENDPOINT="http://minio:9000"
> ```
>
> Point the service at a real `.env` with these values (`env_file: .env`). Do not edit `.env.example`, which is the committed template for host-side development.

To build and run the image on its own:

```bash
bun run build:docker          # docker build -t connectsphere .
docker run -p 3000:3000 --env-file .env connectsphere
```

`Dockerfile` is a two-stage Bun build. It installs with `--frozen-lockfile` and runs `bun run build`. The runner stage carries only `.output`: Nitro traces the server's runtime dependencies into `.output/server/node_modules`, so no copy of `node_modules` or `src` ships. It serves `.output/server/index.mjs` on `0.0.0.0:3000`, with Sentry instrumentation preloaded. Cloud Run injects `PORT`, which the runner honors. The default there is 8080.

## Migrations

`bun run db:migrate` applies the SQL files in `src/db/drizzle/` in order. Never use `db:push` outside local prototyping: it synchronizes the schema without a migration history. Rules and workflow: [DEVELOPMENT.md](./DEVELOPMENT.md#database-management-and-migrations).
