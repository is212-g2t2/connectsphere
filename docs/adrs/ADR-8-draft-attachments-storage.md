---
date: 2026-10-22
adr-number: ADR-8
status: accepted
---

# ADR-8: Draft supporting documents in a private S3 bucket behind one adapter

## Context

Organisers attach floor plans and programmes to draft requests. The files must travel with the
request, stay private, and survive deploys. Uploads and downloads run through server functions,
so the browser never holds bucket credentials.

Local development and integration tests need a real S3 endpoint. The maintainer evaluated
SeaweedFS (`chrislusf/seaweedfs:4.48`) and RustFS (`rustfs/rustfs:1.0.3`) with throwaway
containers and Bun's built-in S3 client, then chose SeaweedFS. The in-memory test adapter is
gone: no test double remains.

## Decision

- One `event_request_attachments` row per file. The row stores the server-generated object key,
  the sanitised original name, the byte-identified content type, and the size. At most ten rows
  per draft; a file holds at most 10 MB as PDF, PNG, JPEG, or DOCX.
- One `AttachmentStorage` seam (`src/features/event-requests/attachments.server.ts`) with one
  adapter. `S3AttachmentStorage` uses Bun's built-in S3 client against a private per-environment
  bucket: Cloudflare R2 in deployed environments, SeaweedFS locally and in integration tests.
- Local development runs SeaweedFS from Compose (`storage` service, pinned image, port 8333,
  volume under `./data/seaweedfs`). The committed `docker/seaweedfs/s3.json` holds the local
  identity, and `-s3.autoCreateBucket` creates the bucket on the first upload, so no
  bucket-creation step exists. The service stays off the default flow: the application runs
  without it, and attaching reports unavailable.
- Integration tests start the same SeaweedFS image in a testcontainer
  (`tests/integration/integration-setup.ts`) and set the `STORAGE_*` variables before test
  files import `#/env`. Node-based Vitest cannot load the `bun` module, so the integration
  project aliases it to a fetch-based S3 client (`tests/shims/bun-integration.ts`) with the
  same surface. Every operation still signs a real SigV4 request against the real container.
- Authenticate with a per-environment Cloudflare R2 API token. Operators create the private
  buckets by hand in the Cloudflare dashboard, then store the token pair as
  `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`. The values never enter Terraform state.
  All five `STORAGE_*` variables are optional; a partial set reports attaching as unavailable
  while the rest of the app works.
- `/api/smoke` uploads and deletes a test object through the real bucket when storage is
  configured, so the release pipeline fails while the bucket or the keys are wrong.

## Alternatives Considered

### Public bucket with signed URLs

- Pros: the browser downloads straight from storage.
- Cons: URL handling, expiry, and revocation beside the existing session model. Draft files need
  no public path.
- Rejected: downloads run through server functions, so the bucket stays private.

### Store bytes in PostgreSQL

- Pros: one system, transactional with the row.
- Cons: 10 MB values bloat the database, backups, and the connection pooler.
- Rejected: the database holds metadata; the bucket holds bytes.

### RustFS 1.0.3 for local development and tests

- Pros: smaller image (417 MB), simple credential setup through environment variables, and a
  fast start. PUT, HEAD, GET, and DELETE all succeed through Bun's S3 client with
  `region: "auto"`.
- Cons: version 1.0.3 marks a young codebase with a small production history next to a
  decade-old filesystem. It creates no bucket on its own, so Compose and the test setup would
  each need a bucket-creation step. The probe run also used more resident memory than SeaweedFS.
- Rejected: maturity and bucket auto-creation carry more weight than image size for a
  development and test dependency.

### In-memory adapter for tests

- Pros: fast tests with no container.
- Cons: the double never signs a request, never authenticates, and never touches the bucket,
  so wire and credential failures stay hidden until release. Its Cloud Run guard adds code that
  only proves the double exists.
- Rejected: integration tests run the real SeaweedFS container, so the adapter and its guard
  are deleted.

## Consequences

- No malware scan. A 10 MB body is buffered per request.
- SeaweedFS identities need explicit actions, or every request answers Access Denied. The
  committed local and test identities grant full bucket actions.
- Follow-ups reuse this seam: removal deletes the object beside the row, and the Coordinator
  view reads through the same handlers.
