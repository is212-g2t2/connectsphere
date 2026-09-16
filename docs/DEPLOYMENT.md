# Deployment

ConnectSphere runs on **Google Cloud Run** in two environments — production at `connectsphere.ciav.dev` from `main`, staging at `connectsphere-staging.ciav.dev` from `staging` — backed by Supabase Postgres, Cloudflare R2 storage and Cloudflare DNS/WAF. The reasoning behind the target is in [ADR-3](./adrs/ADR-3-cloud-run.md); the Terraform that builds it is in [`infra/`](../infra/), with the bootstrap order and the manual steps in [`infra/README.md`](../infra/README.md).

This document covers the deployed topology, the release pipeline, configuration and rollback. The [local Docker workflow](#what-runs-where) follows at the end and remains the only way to run the whole stack on a laptop.

## Topology

```
Client ──► Cloudflare edge (proxied, Free managed WAF)
               └──► Cloud Run (asia-southeast1, project connectsphere-is212)
                        ├── Supabase Postgres — transaction pooler (:6543)
                        ├── Cloudflare R2 bucket — presigned uploads
                        ├── Secret Manager — per-environment configuration
                        └── Resend (email) · Sentry (errors)
```

|                      | Production                                                | Staging                                                      |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Hostname             | `connectsphere.ciav.dev`                                  | `connectsphere-staging.ciav.dev`                             |
| Cloud Run service    | `connectsphere`                                           | `connectsphere-staging`                                      |
| Runtime identity     | `cs-prod-run@connectsphere-is212.iam.gserviceaccount.com` | `cs-staging-run@connectsphere-is212.iam.gserviceaccount.com` |
| Instances (min–max)  | 0–5                                                       | 0–2                                                          |
| R2 bucket            | `connectsphere-uploads`                                   | `connectsphere-staging-uploads`                              |
| Sentry `environment` | `production`                                              | `staging`                                                    |

Both environments live in **one GCP project**; a runtime service account per environment keeps staging out of production's credentials ([ADR-3](./adrs/ADR-3-cloud-run.md#consequences)).

Both services scale to zero, so the first request after idle pays the cold start (Bun boot plus Nitro init), softened by `startup_cpu_boost`. Every revision must pass a startup probe on `GET /api/health` before it receives traffic — an HTTP check, not TCP, so traffic never reaches a process that has not finished booting.

`GET /api/health` is unauthenticated and deliberately does not touch the database. `GET /api/smoke` is the release gate: it requires `Authorization: Bearer $SMOKE_TOKEN`, runs `select 1`, and returns the Cloud Run revision it was served by. An unset `SMOKE_TOKEN` answers 401.

## Releases

A merge to `staging` or `main` runs the same workflow, [`release.yml`](../.github/workflows/release.yml), and `staging` → `main` must be fast-forward. Feature branches open pull requests against `staging` — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the branch contract.

| Merge to  | Deploys    | GitHub Environment | Service                 |
| --------- | ---------- | ------------------ | ----------------------- |
| `staging` | staging    | `staging`          | `connectsphere-staging` |
| `main`    | production | `production`       | `connectsphere`         |

A docs-only change (`**.md`, `docs/**`) does not trigger a release. If the `production` environment has required reviewers, a `main` release pauses after `deploy-stage` and before `migrate`: approving it releases the migration against the production database.

The pipeline starts only after the five check workflows pass (code quality, unit, integration, E2E, security). Then:

| Stage          | What it does                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish`      | Pushes `ghcr.io/is212-g2t2/connectsphere:sha-<short>`. If that tag already exists — the fast-forward case — it is reused instead of rebuilt, and either way the resolved **digest** is what deploys. |
| `deploy-stage` | Authenticates with Workload Identity Federation, records the currently serving revision, deploys the image at **0% traffic** with the `staged` tag.                                                  |
| `migrate`      | `bunx drizzle-kit migrate` against the environment's session-pooler URL, from the exact commit (`actions/checkout` pinned to `github.sha`).                                                          |
| `smoke`        | Reads `<env>-SMOKE_TOKEN`, calls `/api/health` and then `/api/smoke` on the staged tag URL, and fails unless the revision in the response is the revision just staged.                               |
| `promote`      | Moves 100% of traffic to the staged revision and records the image digest, active revision and previous revision in the run summary.                                                                 |
| `cleanup`      | On any failure after staging, removes the `staged` tag. Removing a tag never moves traffic, so this is safe even after a partial promote.                                                            |

A failure after `migrate` leaves the migration applied; `cleanup` only drops the tag, and traffic may already have moved if `promote` failed late. Recovery is fix-forward or a code rollback, never unpicking SQL.

## Configuration

### Secrets

Secret Manager holds fourteen containers: seven names under each environment prefix. The Cloud Run container sees the bare name; the prefix is a Secret Manager naming concern. Values never enter Terraform state or a tfvars file — operators add versions with `gcloud`.

| Secret (`<env>-…`)                      | Purpose                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                          | Supabase **transaction pooler** (`:6543`) URL, consumed by the app with `prepare: false`   |
| `BETTER_AUTH_SECRET`                    | `openssl rand -base64 48`; distinct per environment                                        |
| `SMOKE_TOKEN`                           | `openssl rand -hex 32`; distinct per environment, read by the `smoke` job                  |
| `VITE_SENTRY_DSN`                       | Sentry DSN — a build arg for the browser bundle _and_ a runtime env var for the server SDK |
| `RESEND_API_KEY`                        | Transactional email                                                                        |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | R2 API token scoped to that environment's bucket                                           |

Add or rotate a version:

```bash
gcloud secrets versions add prod-BETTER_AUTH_SECRET \
  --project=connectsphere-is212 --data-file=-
```

Cloud Run resolves `latest` when an instance starts, so a rotated value reaches new instances; deploy a new revision to cycle the running ones.

The GitHub side:

| Name                                                       | Kind                                         | Holds                                                                      |
| ---------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `GCP_WIF_PROVIDER`                                         | repo secret                                  | Workload Identity provider resource name (`terraform output wif_provider`) |
| `GCP_SA`                                                   | repo secret                                  | Deploy service account email (`terraform output deploy_sa`)                |
| `SENTRY_AUTH_TOKEN`                                        | repo secret                                  | Source-map upload; passed to the build as a BuildKit secret                |
| `VITE_SENTRY_DSN`                                          | repo secret                                  | Build arg                                                                  |
| `VITE_SENTRY_ORG`, `VITE_SENTRY_PROJECT`, `VITE_APP_TITLE` | repo variables                               | Build args                                                                 |
| `DATABASE_URL_SESSION`                                     | environment secret (`staging`, `production`) | Session pooler (`:5432`) URL, used only by `migrate`                       |

### Plaintext environment

| Variable                        | Production                                                     | Staging                                  |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `BETTER_AUTH_URL`, `SERVER_URL` | `https://connectsphere.ciav.dev`                               | `https://connectsphere-staging.ciav.dev` |
| `SENTRY_ENVIRONMENT`            | `production`                                                   | `staging`                                |
| `EMAIL_FROM`                    | `onboarding@resend.dev` until `ciav.dev` is verified in Resend | same                                     |
| `MINIO_ENDPOINT`                | R2 S3 endpoint (shared)                                        | same account, different bucket           |
| `MINIO_BUCKET`                  | `connectsphere-uploads`                                        | `connectsphere-staging-uploads`          |

`BETTER_AUTH_URL` must equal the environment's public origin. Better Auth derives its trusted origins from it, there is no `trustedOrigins` override, and the app will boot cheerfully with the wrong value — producing broken verification links and cookie-domain mismatches rather than an error.

### Deployed migrations

`migrate` runs after the new revision is staged at 0% traffic and before promotion, so the previously serving revision handles live traffic against the migrated database during that window. **Migrations must be additive-only.** Never drop or rename a column, and never add a constraint the old revision's writes can violate, in the same release that stops using it — expand in one release, contract in the next. Nothing enforces this mechanically; it is a review rule, and it is what makes the promote and rollback paths safe.

## Rollback and incidents

Rollback never rebuilds an artifact and never touches the database: it moves traffic back to a retained Cloud Run revision. Cloud Run retains previous revisions automatically.

1. Find the revision to restore. Each release's run summary records the previous revision; otherwise list them:

   ```bash
   gcloud run revisions list --service=connectsphere \
     --region=asia-southeast1 --project=connectsphere-is212
   ```

2. Run **Rollback Cloud Run traffic** ([`rollback.yml`](../.github/workflows/rollback.yml)) from the Actions tab, choosing the service and the retained revision. For the production service the run executes in the `production` GitHub Environment, so a required-reviewer rule there applies before traffic moves. Rollback shares the release's concurrency group: if a release for that branch is running or waiting on an approval, cancel it first — it holds the lock and the rollback would wait behind it.

3. Verify before standing down:

   ```bash
   curl -fsS https://connectsphere.ciav.dev/api/health
   SMOKE_TOKEN="$(gcloud secrets versions access latest \
     --secret=prod-SMOKE_TOKEN --project=connectsphere-is212)"
   curl -fsS -H "Authorization: Bearer $SMOKE_TOKEN" https://connectsphere.ciav.dev/api/smoke
   ```

   The `revision` in the second response must be the revision traffic was moved to.

**Rollback is traffic-only.** Migrations are not reversed, so rolling back after a breaking schema change runs old code against the new schema.

Rehearse the path on staging before you need it in production: roll `connectsphere-staging` back to the previous revision, confirm traffic moves, then roll forward.

## What runs where

`docker-compose.yaml` (compose project `connectsphere`) defines five services:

| Service         | Port       | Data                | Notes                                                      |
| --------------- | ---------- | ------------------- | ---------------------------------------------------------- |
| `postgres`      | 5432       | `./data/postgres`   | Postgres 18, database `app`, user/password `postgres`      |
| `minio`         | 9000, 9001 | `./data/minio/data` | S3-compatible storage; console on 9001, `admin`/`password` |
| `minio_init`    | —          | —                   | Runs once to create the `app` bucket, then exits           |
| `redis`         | 6379       | —                   | Redis 7                                                    |
| `connectsphere` | 3000       | —                   | The app itself, built from `Dockerfile`                    |

State lives in bind mounts under `./data`, not named volumes — deleting that directory resets the database and object store, and renaming the compose project does not orphan anything.

## The normal loop: services in Docker, app on the host

This is what [DEVELOPMENT.md](./DEVELOPMENT.md) assumes and what the test suites expect.

```bash
docker compose up -d postgres redis minio minio_init
bun run db:migrate
bun run dev
```

`.env.example` is written for exactly this shape: `DATABASE_URL` and `MINIO_ENDPOINT` point at `localhost`, which is correct when the app runs on the host.

> [!IMPORTANT]
> Start the `connectsphere` service only when you actually want the containerised app. It binds port 3000, and `playwright.config.ts` sets `reuseExistingServer`, so Playwright will silently attach to the container instead of starting a dev server — and because of the caveat below, every test that signs up then fails with "Could not create your account." Run `docker compose stop connectsphere` before `bun run test:e2e`.

## Running the whole stack in Docker

```bash
docker compose up -d
```

> [!WARNING]
> The `connectsphere` service loads `env_file: .env.example`, whose hostnames are `localhost` — which inside a container is that container, not the database. The app boots and serves the landing page and `/api/health`, but anything touching Postgres or MinIO fails. Override the two hostnames with compose service names before relying on it:
>
> ```
> DATABASE_URL="postgresql://postgres:postgres@postgres:5432/app"
> MINIO_ENDPOINT="http://minio:9000"
> ```
>
> Point the service at a real `.env` carrying these (`env_file: .env`) rather than editing `.env.example`, which is the committed template for host-side development.

To build and run the image on its own:

```bash
bun run build:docker          # docker build -t connectsphere .
docker run -p 3000:3000 --env-file .env connectsphere
```

`Dockerfile` is a two-stage Bun build: it installs with `--frozen-lockfile`, runs `bun run build`, prunes dev dependencies, and the runner stage serves `.output/server/index.mjs` on `0.0.0.0:3000` with Sentry instrumentation preloaded. Cloud Run injects `PORT`, which the runner honours; the default there is 8080.

## Migrations

Apply pending migrations before starting a new build, locally or anywhere else:

```bash
bun run db:migrate
```

This runs the SQL files in `src/db/drizzle/` in order through Drizzle Kit. Never use `db:push` outside local prototyping — it syncs the schema without recording migration history. `bun run db:seed` adds the demo and staff accounts described in the [README](../README.md).
