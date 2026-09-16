---
date: 09-14-2026
adr-number: ADR-1
status: accepted
---

# ADR-1: Use TanStack Start over Next.js or a split frontend–backend app

## Context

ConnectSphere is an SSR event-planning and venue-booking application: five roles, session-based auth, server functions, file uploads, and SEO-relevant public pages (`robots.txt`, sitemap, structured data). It is built and run on Bun, and the runtime uses Bun-native APIs — `bun:sql` via `drizzle-orm/bun-sql`, `Bun.s3`, and `Bun.RedisClient`.

The team is small and optimises for iteration speed and type safety over a large framework ecosystem. Requirements:

- Server-rendered HTML for public and crawler-facing pages.
- End-to-end TypeScript types from route to database.
- Auth checks that can run both in route guards and inside server functions.
- A deployment target that runs the Bun-native drivers as-is (see ADR-3).

A further driver: the TanStack Start template arrives batteries-included. Docker and Compose setup, CI workflows, Drizzle configuration, Sentry instrumentation, seed scripts, and a shadcn/ui primitive layer are already wired together, where building that scaffolding from scratch would consume significant time before any product feature shipped.

Three options were on the table: TanStack Start, Next.js, and a split single-page frontend with a separate API backend.

## Decision

Build on **TanStack Start** with **Nitro** as the server layer, keeping routes, server functions, and data loading in one TypeScript project. Start is built on top of Vite, so the existing Vite plugin ecosystem and build pipeline apply. The starter template's conventions — TanStack Router, Query, Form, and Table — are adopted wholesale rather than mixing in another meta-framework's model.

## Alternatives Considered

### Next.js

- Pros: largest React meta-framework community, mature SSR and hosting story, App Router conventions.
- Cons: the React Server Components model is a larger concept surface than this CRUD-heavy app needs; the project's type-safe data layer is TanStack Router/Query, so choosing Next.js splits the routing and data-loading model across two ecosystems; Turbopack, Next.js's bundler, becomes slow as the codebase grows, where Start inherits Vite's faster pipeline; the Bun-native runtime drivers (`bun:sql`, `Bun.s3`, `Bun.RedisClient`) sit outside Next.js's first-class path.
- Rejected: TanStack Start provides the same SSR and full-stack colocation this app needs, while keeping one router/query/form model and the Bun runtime; Next.js's ecosystem advantage does not outweigh the split it would introduce.

### Split frontend + API backend

- Pros: independent deploys, a hard contract between client and server, freedom to scale or rewrite either side, ability to use a different language on the server.
- Cons: two deployables and two repositories (or a monorepo) for a single small team; the web/API contract must be maintained by hand instead of inferred from server-function types; sessions, CORS, and CSRF need explicit plumbing where colocated server functions get them from the same origin and cookie jar.
- Rejected: the operational and contract overhead is not justified at this team size. Feature modules under `src/features/` keep internal boundaries clean, so an API can be extracted later if a client other than this web app needs one.

## Consequences

- One codebase, one deployable, one set of Zod schemas and TypeScript types shared across the client/server boundary.
- The whole app redeploys for any server-side change; there is no partial rollout of a backend only.
- Every client-reachable module must respect the server-only import rules in `AGENTS.md` (dynamic imports for `#/db`, no static `#/db/schema`, `.server.ts` only for modules nothing client-reachable imports); `tests/unit/client-bundle-safety.test.ts` enforces this.
- Hosting must run the Bun runtime or the three native drivers need replacing (ADR-3).
- The team commits to the TanStack ecosystem (Router, Query, Form, Table) for routing, data loading, and forms.
