---
date: 2026-09-14
adr-number: ADR-2
status: accepted
---

# ADR-2: Use a monolithic architecture over microservices

## Context

ConnectSphere is a single product with a single team, one PostgreSQL database, and modest traffic. Its domain data is highly relational: users, sessions, roles, event requests, and venues reference each other. Writes such as saving a venue or an event-request draft need transactional consistency. No component has independent scaling pressure.

Deployment currently targets one container (`docs/DEPLOYMENT.md`). The application code is already organized by feature under `src/features/`, with server functions and server-only modules per feature.

The alternative was a split into microservices from the start: separate services for users, authentication, events, venues, and uploads.

## Decision

Build ConnectSphere as a **modular monolith**: one deployable application and one PostgreSQL schema, with feature modules under `src/features/` as the internal boundaries. The team can extract features into services later, but only when a concrete driver appears (independent scaling, a separate team, or a non-web consumer).

## Alternatives Considered

### Microservices

- Pros: independent deploy and scale per service, failure isolation, polyglot freedom, and ownership boundaries that survive team growth.
- Cons: a small team and one product must carry the distributed system overhead. That overhead is service discovery, inter-service authentication, network latency and partial failure, distributed tracing, and multiple CI/CD pipelines and migration streams. Cross-service transactions replace the single-database atomicity, consistency, isolation, and durability (ACID) guarantees. Independent scaling solves no problem that this application has today.
- Rejected: the operational cost is real and immediate, while the benefits are speculative. The feature modules already give the modularity that a later extraction needs.

## Consequences

- One deploy, one migration stream, and one connection pool to operate.
- Debugging, transactions, and session handling stay simple: no distributed tracing or network failure modes between components.
- The deploy blast radius is the whole application. A bad change rolls back everything, not one service.
- Scaling is vertical or whole-application horizontal. If one workload (for example uploads or search) ever dominates, the team must extract or scale it separately.
- The team enforces feature boundaries by convention and tests, not by the network. The team can extract a service cheaply only while modules keep their internals private.
