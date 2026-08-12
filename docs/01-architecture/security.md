# Security model

SIHL ONE holds PAN, mobile, email, address and relationship data for customers of a
SEBI-registered broker. This document states what is defended, how, and what is not yet
defended.

## Threat model

| Threat                                                | Control                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Credential stuffing                                    | Argon2id + pepper, 5-attempt lockout, 5/min login throttle, full attempt log |
| Account enumeration via the login form                 | Identical failure message for every cause; dummy hash on the unknown-account path so timing matches |
| Stolen database dump                                   | Argon2id with a pepper held outside the database; only refresh-token hashes stored |
| Stolen access token                                    | 15-minute TTL; the principal is re-resolved from the database on every request, so revocation is immediate |
| Stolen refresh token                                   | Opaque, single-use, rotated; reuse revokes every session for that user  |
| XSS stealing a session                                 | Tokens in httpOnly cookies; strict CSP; no `localStorage` session data  |
| CSRF                                                   | `sameSite=lax` cookies + a CORS allow-list of one origin                |
| Horizontal privilege escalation (reading others' data) | ABAC row filter composed into every query; out-of-scope reads return 404 |
| Horizontal privilege escalation (**writing** others' data) | Same filter on write paths, proven by a dedicated e2e regression test |
| Vertical privilege escalation                          | Permission-based guards; denials audited                                |
| SQL injection                                          | Prisma parameterises everything; `sortBy` is checked against an allow-list rather than passed through |
| Mass PII exposure via list endpoints                   | Server-side masking in list responses; full values only on single-record reads, which are audited |
| Audit tampering                                        | Append-only by design; DB grants restricted to INSERT/SELECT (checklist item) |
| Payload-based denial of service                        | 256 kB body cap, pagination capped at 100, rate limits                  |
| Information leakage through errors                     | Problem Details only; no stack, SQL, constraint name or ORM message crosses the boundary |

## Defence in depth on authorisation

Three layers, each of which alone would be insufficient:

1. **UI** hides controls the user cannot use. Convenience only.
2. **Guards** reject the request if the permission is missing.
3. **Query filters** limit the rows even when the permission is present.

Layer 3 is the one that matters most and is the easiest to forget. A sales executive
legitimately holds `lead:read`; without the row filter that permission returns the entire
company's pipeline.

### A real defect, and what it changed

During Phase 1, a validation decorator bound the request body to parameter index 0 — the
`@CurrentUser()` slot — on every write handler. The authenticated principal was replaced by
the request payload, `dataScope` became `undefined`, and the ABAC filter collapsed to
`{ ownerId: undefined }`. Prisma treats an `undefined` value as *no condition*, so the filter
vanished.

The effect: reads were correctly locked down (a sales executive got 404 for another RM's
lead) while **writes were completely open** — the same executive could change that lead's
status. It was found by tracing a failing end-to-end test rather than by reading the code.

Three things changed as a result:

1. The decorator is now a parameter decorator and never guesses a position.
2. An e2e regression test asserts an out-of-scope **write** returns 404 *and* that the record
   is unchanged afterwards.
3. `ScopeService` fails closed — a hierarchy-scoped user with no org unit gets
   `{ id: '__no_access__' }` rather than an empty filter.

The general lesson worth carrying: **an authorisation test suite that only tests reads can
give a clean bill of health while the system is wide open.**

## PII handling

- **Masked in lists, full on detail.** Masking is server-side; the full value never crosses
  the wire on a list request, where it would land in browser caches and proxy logs.
- **Audit redaction.** Passwords, hashes, PAN and date of birth are `[redacted]`; mobile and
  email are masked but retained so a *change* is still auditable.
- **Consent is an append-only ledger.** Withdrawal is a new row, never an update, so the
  history of what a person agreed to is reconstructable years later.
- **Verbatim consent text is stored**, not a paraphrase. A paraphrase is not evidence.

## Secrets

Validated at boot; the process refuses to start on invalid configuration. In production the
validator additionally rejects: access and refresh secrets that match each other, any value
still containing the development placeholder, and a wildcard CORS origin. These are the
mistakes that actually happen — a `.env` copied from a laptop onto a server.

## Known gaps

MFA, a managed secrets vault, restricted audit-table grants, centralised log aggregation,
penetration testing and the DPDP review are all outstanding and listed as blockers in the
[production checklist](../production-checklist.md).
