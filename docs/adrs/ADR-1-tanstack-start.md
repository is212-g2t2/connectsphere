---
date: 2026-09-14
adr-number: ADR-1
status: accepted
---

# ADR-1: Use TanStack Start over Next.js or a split frontend–backend app

> **Amended 2026-10-04:** the template's presigned-upload demo and its object storage were removed (PTR-121), along with the unused `@tanstack/react-table` primitive set. The decision below stands on `bun:sql`; `Bun.RedisClient` remains wired but unused.

## Context

ConnectSphere is a server-side rendered (SSR) event-planning and venue-booking application. It has five roles, session-based authentication, server functions, file uploads, and public pages for SEO (`robots.txt`, sitemap, structured data). The application uses Bun for the build and the runtime. The runtime uses Bun-native APIs: `bun:sql` through `drizzle-orm/bun-sql`, `Bun.s3`, and `Bun.RedisClient`.

The team is small, so it prefers iteration speed and type safety over a large framework ecosystem. The requirements are:

- Server-rendered HTML for public and crawler-facing pages.
- End-to-end TypeScript types from the route to the database.
- Authentication checks that can run in route guards and in server functions.
- A deployment target that runs the Bun-native drivers as supplied (see ADR-3).

A further driver is the TanStack Start template: it already includes the scaffolding for a new project. Docker and Compose setup, continuous integration (CI) workflows, Drizzle configuration, Sentry instrumentation, seed scripts, and a shadcn/ui primitive layer are already wired together. A team that builds that scaffolding from scratch spends significant time before the first product feature ships.

The team considered three options: TanStack Start, Next.js, and a split single-page frontend with a separate API backend.

## Decision

Build on **TanStack Start** with **Nitro** as the server layer. Keep routes, server functions, and data loading in one TypeScript project. TanStack Start uses Vite, so the existing Vite plugin ecosystem and build pipeline apply. The project adopts the starter template's conventions (TanStack Router, Query, Form, and Table) in full. It does not mix in another meta-framework's model.

## Alternatives Considered

### Next.js

- Pros: the largest React meta-framework community, a mature SSR and hosting story, App Router conventions.
- Cons: the React Server Components model is a larger concept surface than this CRUD-heavy application needs. The project's type-safe data layer is TanStack Router/Query, so Next.js splits the routing and data-loading model across two ecosystems. Turbopack, the Next.js bundler, becomes slow as the codebase grows, but Start inherits Vite's faster pipeline. The Bun-native runtime drivers (`bun:sql`, `Bun.s3`, `Bun.RedisClient`) sit outside the Next.js first-class path.
- Rejected: TanStack Start gives the same SSR and full-stack colocation that this application needs. It keeps one router/query/form model and the Bun runtime. The Next.js ecosystem advantage does not justify the split between two ecosystems.

### Split frontend + API backend

- Pros: independent deploys, a hard contract between the client and the server, freedom to scale or rewrite either side, and a choice of server language.
- Cons: the split needs two deployables and two repositories (or a monorepo) for a single small team. The team must maintain the web/API contract by hand, not infer it from server-function types. Sessions, cross-origin resource sharing (CORS), and cross-site request forgery (CSRF) need explicit plumbing. Colocated server functions get them from the same origin and cookie jar.
- Rejected: the operational and contract overhead is not justified at this team size. Feature modules under `src/features/` keep internal boundaries clean. The team can extract an API later if a client other than this web application needs one.

## Consequences

- One codebase, one deployable, and one set of Zod schemas and TypeScript types shared across the client/server boundary.
- A server-side change redeploys the whole application. There is no partial rollout of a backend only.
- Every client-reachable module must obey the server-only import rules in `AGENTS.md`. The rules are dynamic imports for `#/db`, no static `#/db/schema`, and `.server.ts` only for modules that nothing client-reachable imports. `tests/unit/client-bundle-safety.test.ts` enforces them.
- Hosting must run the Bun runtime, or the team must replace the three native drivers (ADR-3).
- The team commits to the TanStack ecosystem (Router, Query, Form, Table) for routing, data loading, and forms.
