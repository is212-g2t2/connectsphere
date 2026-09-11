# Deployment

ConnectSphere is not deployed anywhere yet. This document covers running it locally under Docker, which is the only supported target today. Hosting is chosen in a later story; see [Choosing a hosting target](#choosing-a-hosting-target) for what that will involve.

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

`.env.example` is written for exactly this shape: `DATABASE_URL`, `MINIO_ENDPOINT` and `REDIS_URL` all point at `localhost`, which is correct when the app runs on the host.

> [!IMPORTANT]
> Start the `connectsphere` service only when you actually want the containerised app. It binds port 3000, and `playwright.config.ts` sets `reuseExistingServer`, so Playwright will silently attach to the container instead of starting a dev server — and because of the caveat below, every test that signs up then fails with "Could not create your account." Run `docker compose stop connectsphere` before `bun run test:e2e`.

## Running the whole stack in Docker

```bash
docker compose up -d
```

> [!WARNING]
> The `connectsphere` service loads `env_file: .env.example`, whose hostnames are `localhost` — which inside a container is that container, not the database. The app boots and serves the landing page and `/api/health`, but anything touching Postgres, MinIO or Redis fails. Override the three hostnames with compose service names before relying on it:
>
> ```
> DATABASE_URL="postgresql://postgres:postgres@postgres:5432/app"
> MINIO_ENDPOINT="http://minio:9000"
> REDIS_URL="redis://redis:6379"
> ```
>
> Point the service at a real `.env` carrying these (`env_file: .env`) rather than editing `.env.example`, which is the committed template for host-side development.

To build and run the image on its own:

```bash
bun run build:docker          # docker build -t connectsphere .
docker run -p 3000:3000 --env-file .env connectsphere
```

`Dockerfile` is a two-stage Bun build: it installs with `--frozen-lockfile`, runs `bun run build`, prunes dev dependencies, and the runner stage serves `.output/server/index.mjs` on `0.0.0.0:3000` with Sentry instrumentation preloaded.

## Migrations

Apply pending migrations before starting a new build, locally or anywhere else:

```bash
bun run db:migrate
```

This runs the SQL files in `src/db/drizzle/` in order through Drizzle Kit. Never use `db:push` outside local prototyping — it syncs the schema without recording migration history. `bun run db:seed` adds the demo and staff accounts described in the [README](../README.md).

## Choosing a hosting target

Nitro builds with `preset: "bun"`, set in `vite.config.ts`. The preset can be changed there, or via the `NITRO_PRESET` environment variable at build time.

The constraint that will decide the target: the app uses Bun-native APIs — `bun:sql` through `drizzle-orm/bun-sql`, `Bun.s3` for presigned uploads, and `Bun.RedisClient`. Any platform that runs the container as-is (Cloud Run, Container Apps, ECS/Fargate, Railway, Fly.io, Render) needs no code change. A non-Bun serverless runtime would mean replacing all three drivers, so that trade is worth settling before picking a host rather than after.

Two things any hosted environment will need beyond the container: a Postgres connection pooler if the platform is serverless and short-lived, and the variables from `.env.example` set as real secrets — `BETTER_AUTH_SECRET` above all, plus `RESEND_API_KEY` and `EMAIL_FROM` for mail and `VITE_SENTRY_DSN` for error reporting.
