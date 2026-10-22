---
date: 2026-10-20
adr-number: ADR-8
status: accepted
---

# ADR-8: Draft supporting documents in private object storage behind a two-adapter seam

## Context

Organisers attach floor plans and programmes to draft requests. The files must travel with the
request, stay private, and survive deploys. Uploads and downloads run through server functions,
so the browser never holds bucket credentials.

## Decision

- One `event_request_attachments` row per file. The row stores the server-generated object key,
  the sanitised original name, the byte-identified content type, and the size. At most ten rows
  per draft; a file holds at most 10 MB as PDF, PNG, JPEG, or DOCX.
- One `AttachmentStorage` seam (`src/features/event-requests/attachments.server.ts`) with two
  adapters. `S3AttachmentStorage` uses Bun's built-in S3 client against a private per-environment
  bucket (GCS S3 interop when deployed, MinIO locally). `MemoryAttachmentStorage` serves
  integration tests and refuses to start on Cloud Run.
- The server writes the object first, then in one short transaction locks the event row, checks
  the request is still the caller's draft under the attachment limit, and inserts the row. A
  failed check deletes the object (best effort, logged) and refuses with the reason named.
- The stored and served content type comes from magic-byte detection, never the client header.
- Authenticate with per-environment GCS HMAC keys. Operators create each pair with
  `gcloud storage hmac create` and store it as `STORAGE_ACCESS_KEY_ID` /
  `STORAGE_SECRET_ACCESS_KEY`. The values never enter Terraform state, and only the
  environment's runtime account reads them. All five `STORAGE_*` variables are optional; an
  unset `STORAGE_BUCKET` reports attaching as unavailable while the rest of the app works.
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

### One adapter with an endpoint flag

- Pros: less code today.
- Cons: tests would need a live S3 endpoint, and nothing stops test config reaching production.
- Rejected: the memory adapter keeps tests hermetic and cannot start on Cloud Run.

## Consequences

- No malware scan. A 10 MB body is buffered per request.
- Follow-ups reuse this seam: removal deletes the object beside the row, and the Coordinator
  view reads through the same handlers.
