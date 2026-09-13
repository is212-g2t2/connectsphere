---
date: 09-14-2026
adr-number: ADR-2
status: accepted
---

# ADR-2: Use a monolithic architecture over microservices

## Context

ConnectSphere is a single product with a single team, one PostgreSQL database, and modest traffic. Its domain data is highly relational: users, sessions, roles, event requests, and venues reference each other, and writes such as saving a venue or an event-request draft need transactional consistency. There is no component with independent scaling pressure.

Deployment currently targets one container (`docs/DEPLOYMENT.md`), and the application code is already organised by feature under `src/features/` with server functions and server-only modules per feature.

The alternative considered was splitting the system into microservices (separate user/auth, event, venue, and upload services) from the start.

## Decision

Build ConnectSphere as a **modular monolith**: a single deployable application and a single PostgreSQL schema, with feature modules under `src/features/` as the internal boundaries. Features may be extracted into services later, but only when a concrete driver appears (independent scaling, a separate team, or a non-web consumer).

## Alternatives Considered

### Microservices

- Pros: independent deploy and scale per service, failure isolation, polyglot freedom, ownership boundaries that survive team growth.
- Cons: a distributed system's overhead — service discovery, inter-service auth, network latency and partial failure, distributed tracing, multiple CI/CD pipelines and migration streams — imposed on a small team and one product; cross-service transactions would replace the current single-database ACID guarantees; independent scaling solves no problem this app currently has.
- Rejected: the operational cost is real and immediate, while the benefits are speculative. The feature modules already provide the modularity that makes a later extraction possible.

## Consequences

- One deploy, one migration stream, and one connection pool to operate.
- Debugging, transactions, and session handling stay simple: no distributed tracing or network failure modes between components.
- Deploy blast radius is the whole application — a bad change rolls back everything, not one service.
- Scaling is vertical or whole-app horizontal; if one workload (for example uploads or search) ever dominates, it must be extracted or scaled separately then.
- Feature boundaries are enforced by convention and tests, not by the network. A service extraction is only cheap while modules keep their internals private.
