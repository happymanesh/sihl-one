# ADR-0008 — File handling: swappable storage, sniffed content, gated downloads

**Status:** Accepted · 2026-08-09

## Context

Phase 2 introduces two file flows: a check-in selfie captured on a phone before
the visit record exists, and documents attached to leads, customers and partners.
Files are uploaded by internal staff *and* by external partners, and downloaded
by other staff — so an upload is a genuine transmission path between parties.

## Decisions

### 1. Storage sits behind a driver interface

`StorageDriver` has a filesystem implementation for development and CI, and an S3
implementation for deployed environments. Nothing above the interface — services,
controllers, or tests — knows which is active.

The local driver exists because the object store is not always available on a
developer machine (no Docker on some of them). Stubbing uploads out instead would
have left the whole visit and document flow untested until deployment, which is
exactly where file bugs are most expensive. The configuration validator rejects
`STORAGE_DRIVER=local` in production, so the convenience cannot leak.

### 2. Upload is a separate step from attachment

`POST /files` stores bytes and returns an opaque key; the business endpoint then
references that key. Two reasons:

- A check-in photo is taken *before* the check-in is submitted, so the file has
  no owning record yet.
- Business endpoints stay JSON-only, and one hardened path carries every type,
  size, sniffing and scanning check rather than each endpoint reimplementing it.

The key is worthless on its own. It is accepted only by an endpoint that
re-checks the caller's rights, the check-in verifies the object actually exists
before trusting it, and reading any object back always requires a signed,
user-bound, expiring grant.

### 3. Content is sniffed, not trusted

The declared `Content-Type` is attacker-controlled. Every upload's leading bytes
are checked against the magic number for its claimed type.

Without this, `evil.html` announced as `image/jpeg` passes the allow-list, is
stored, and is later served from our own origin — which is stored XSS. The
allow-list is also an allow-list rather than a block-list of dangerous types,
because a block-list is always missing the next format nobody thought of. SVG is
deliberately excluded: it is an image that can carry script.

### 4. Only confirmed-clean files can be downloaded

`scanStatus` must be `CLEAN`. `PENDING` and `FAILED` both mean *we do not know*,
and treating "we do not know" as safe is how a malicious upload reaches an
employee's desktop.

The development scanner therefore returns **FAILED, not CLEAN**. A no-op that
reported CLEAN would launder every file through the system and make an unscanned
production deployment invisible. There is an explicit `FILE_SCANNER_MODE=permissive`
for CI, and the configuration validator refuses it in production.

Files are always served with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`, so a stored file is never rendered as a
document in our origin regardless of the allow-list.

### 5. Downloads are short-lived, user-bound signed grants

An HMAC over `key | userId | expiry`, verified in constant time. This is what
allows a URL to be handed to a browser at all: the alternative is streaming every
document through an authenticated endpoint, which does not survive an `<img>`
tag. A link cannot be edited to point at another object, cannot be forwarded to a
colleague who lacks access, and stops working on its own.

### 6. The browser never talks to the API directly

Uploads and downloads pass through Next.js route handlers that attach the token
server-side, because the access token lives in an httpOnly cookie the browser
cannot read (ADR-0004). Those handlers rebuild the upstream URL from validated
narrow parameters rather than forwarding a caller-supplied path — a forwarded
path would make them a server-side request forgery primitive aimed at anything
the server can reach, with our credentials attached.

## Consequences

- Storage keys never contain the user's filename. The original name is metadata,
  sanitised for display and for the download filename.
- The same bytes uploaded twice against one record reuse the existing row.
- Deletion is soft; the object is retained for the retention job, which knows the
  regulatory minimum. Whoever clicked delete does not.
- Wiring ClamAV remains a production blocker, and the UI shows an "Unscanned"
  badge with the reason rather than silently hiding the download button.
