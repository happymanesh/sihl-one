# ADR-0005 — One executable contract shared by API and web

**Status:** Accepted · 2026-08-09

## Context

The same rules must hold in the browser (for fast feedback) and on the server (where they are
actually enforced): what a valid PAN is, which lead status may follow which, what each role
may do.

## Decision

`packages/contracts` holds enums, the RBAC matrix, Zod schemas, the lead-status transition
table, the scoring model and PII masking helpers. Both apps import it.

Zod is used for request validation instead of class-validator. The cost is that Swagger cannot
infer schemas from decorator metadata, so a small `zod-to-json-schema` bridge feeds
`@nestjs/swagger`. That cost is worth paying once to avoid two divergent rule sets.

## Why it matters concretely

- The lead detail screen greys out impossible status transitions using
  `LEAD_STATUS_TRANSITIONS` — the same table `changeStatus` enforces. The UI cannot offer a
  move the API will reject.
- `scoreLead()` runs in the API *and* in the seed, so demo data is scored by the real scorer
  rather than by invented numbers.
- Contract tests assert that the RBAC matrix references only permissions that exist, and that
  scope can never widen. A typo in a permission string fails CI rather than production.

## Consequences

- `@sihl-one/contracts` must be built before either app. CI does this explicitly, in order.
- The package is CommonJS so NestJS consumes it natively; Next transpiles it via
  `transpilePackages`.
