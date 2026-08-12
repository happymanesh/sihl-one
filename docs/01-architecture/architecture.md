# SIHL ONE — Architecture

## 1. What this system is

SIHL ONE is the **System of Engagement** for Shah Investors Home Ltd. It owns the
relationship with a person from the first marketing touch to an ongoing customer
relationship, and it connects the departments that currently work from separate tools.

It is explicitly **not** the system of record for anything a regulator would ask about.
Holdings, ledgers, contract notes, margin and KYC artefacts remain in the back office and
the eKYC platform. SIHL ONE mirrors what it needs, read-only, and stamps every mirrored row
with `sourceSystem`, `externalRef` and `syncedAt` so nobody can mistake a copy for the truth.

That boundary is the single most important decision in this document. Without it, a CRM
grows into a shadow book of record, and the day it disagrees with the back office is the day
a compliance problem starts. See [ADR-0002](../adr/0002-system-of-engagement.md).

## 2. The journey the system implements

```
Marketing → Lead capture → CRM / qualification → Sales follow-up
   → Digital onboarding → Account opening → Activation → Trading
   → Relationship management → Cross-sell → Retention
```

Phase 1 implements the chain up to and including the **hand-off to onboarding**. Conversion
emits a `lead.converted` event carrying PAN, mobile, email and the owning RM; the eKYC
integration consumes it. Everything downstream of account opening is mirrored back.

The point of building it as one chain rather than five tools is attribution: because the
customer record keeps `leadId`, and the lead keeps its campaign and UTM parameters, the
question "what did this customer cost us to acquire" is a join, not a project.

## 3. Runtime shape

```
                    Browser / PWA
                          │  HTTPS
                          ▼
              ┌───────────────────────┐
              │  Next.js 16 (web)     │   Server Components render on the server
              │  · server actions     │   and hold the access token in an
              │  · httpOnly cookies   │   httpOnly cookie — never in JS reach
              └───────────┬───────────┘
                          │  Bearer JWT (server-to-server)
                          ▼
              ┌───────────────────────┐
              │  NestJS 11 API        │
              │  Throttler → JwtAuth  │
              │  → Permissions        │
              │  → Audit interceptor  │
              └───────────┬───────────┘
                          │  Prisma 7 + pg driver adapter
                          ▼
              ┌───────────────────────┐
              │  PostgreSQL 16        │
              │  + transactional      │
              │    outbox             │
              └───────────┬───────────┘
                          │ (Phase 2) relay worker
                          ▼
        Back office · eKYC · WhatsApp · SMS · Email · Analytics
```

The browser never talks to the API directly. Every call originates from the Next.js server,
which is why the access token can live in an httpOnly cookie and why the API needs to trust
exactly one origin.

## 4. Where code lives, and why

```
packages/contracts     Enums, RBAC matrix, Zod schemas, lead scoring, PII masking
apps/api               NestJS — the only thing that touches the database
apps/web               Next.js — the only thing that renders HTML
```

`packages/contracts` is imported by both. It is not a "types" package; it holds executable
rules:

- `LEAD_STATUS_TRANSITIONS` — the UI greys out impossible moves using the same table the API
  enforces, so the two cannot disagree.
- `ROLE_PERMISSIONS` — seeded into the `role` table, so the database is authoritative at
  runtime while the code remains the readable statement of intent.
- `scoreLead()` — one scoring implementation, so a score shown in a list is the score the
  API stored.
- Zod schemas — one definition of a valid PAN, mobile, password and payload, so client-side
  validation is a convenience and server-side validation is the same rule, not a re-write.

## 5. The request path

Every authenticated request passes through the same five stages, in this order:

1. **RequestContextMiddleware** — establishes a trace id (honouring an inbound
   `x-request-id`), the client IP and the user agent in AsyncLocalStorage.
2. **ThrottlerGuard** — cheapest check first, so it protects the two that follow.
3. **JwtAuthGuard** — verifies the token, then **rebuilds the principal from the database**.
   A revoked session, suspended account or changed role therefore takes effect on the next
   request rather than at token expiry. That costs one indexed query; for a system holding
   customer PII, fifteen minutes of stale authority is not a trade worth making.
4. **PermissionsGuard** — RBAC. A denial is written to the audit log, because "someone tried
   something they are not allowed to do" is precisely the signal a security team wants and
   is invisible if the only record is a 403 in an access log.
5. **Service layer** — composes the **ABAC row filter** into every query.

Errors are converted to RFC 9457 Problem Details by a single filter. No stack trace, SQL,
constraint name or Prisma message crosses the boundary; the client gets a stable title and
a `traceId` to quote at support.

## 6. Authorisation: two independent checks

Authorisation is deliberately two questions, and both must be answered:

| Question                                     | Mechanism          | Where                 |
| -------------------------------------------- | ------------------ | --------------------- |
| May this role perform this action *at all*?   | RBAC — permissions | `PermissionsGuard`    |
| On *which rows*?                              | ABAC — data scope  | `ScopeService`        |

Passing the first and skipping the second is how CRMs leak. A sales executive legitimately
holds `lead:read`; without a row filter that permission returns the entire company's
pipeline. So the filter is not an optional refinement applied by whoever remembers — every
repository query composes it, and the e2e suite proves a scoped user cannot read *or write*
out-of-scope rows.

Scopes mirror the hierarchy SIHL already uses in the back office, so "branch" means the same
thing in every system:

`ALL → ZONE → REGION → BRANCH → TEAM → SELF`

Subtree scopes are resolved with a **materialised path** on `org_unit` (`/root/zone/region/
branch/`), making a subtree query one indexed prefix match rather than a recursive CTE per
request. The hierarchy changes a few times a year and is read on every list query, so the
denormalisation pays for itself many times over.

A user's effective scope is `min(role default, user record)`. Widening via the user record
is silently ignored rather than rejected, so a mis-keyed admin edit degrades to *less*
access, never more.

## 7. Data model decisions worth knowing

**Business rules live in the database where being bypassed would be serious.** The
application validates them too, but a constraint cannot be skipped by an import script or a
manual fix:

- One open lead per mobile (and per PAN) — a *partial* unique index, because the rule
  applies only to live pipeline rows; someone lost last year may legitimately return.
- A `LOST` lead must carry a reason — otherwise lost-reason analytics is full of nulls.
- A completed visit must have both a check-in and a check-out, and check-out cannot precede
  check-in — visit records feed incentive calculations.

**Money is `Decimal(18,2)`, never a float,** and crosses the wire as a *string*. Prisma
returns `Decimal`, and `JSON.stringify` would turn that into a JavaScript number that cannot
represent every rupee value exactly.

**Soft delete everywhere.** Nothing a regulator might ask about is hard-deleted by the
application.

**Audit is append-only.** No update or delete path exists in the code, and the runtime
database role should hold only `INSERT` and `SELECT` on `audit_log`, so a compromised
application cannot rewrite its own tracks. PII is redacted or masked on the way in, because
the audit trail is read by more people than the source tables are.

**Transactional outbox.** Integration events are written in the same transaction as the state
change. Publishing after the commit leaves a window in which a crash loses the event
permanently — which here means a converted lead whose eKYC never starts, or a visit that
never reaches the incentive engine. Both are failures nobody notices for a month. Consumers
must be idempotent; the relay guarantees at-least-once, and exactly-once across a network is
not available at any price.

## 8. AI: rules now, models later

Lead scoring and next best actions ship as **explicit, explainable rules**, not a model.
Three reasons:

1. There is no training data yet. SIHL ONE is the system that will *produce* the labelled
   outcomes a model needs. Shipping a model first means shipping someone's guesses with a
   probability attached — worse than transparent rules.
2. The interface (`ScoringFeatures` in, `LeadScore` out) is exactly what a model endpoint
   will expose. When `POST /ai/lead-score` goes live it replaces the body of `scoreLead`, not
   its callers.
3. Every factor is returned with its contribution, so an RM can be told *why* a lead is hot.
   An unexplained score gets ignored by a sales floor, and correctly so.

Scores are **persisted** rather than computed per request, so the pipeline can be sorted and
filtered by score in the database, and so a score can still be explained after the model
changes.

## 9. Known limits

These are real and stated deliberately rather than discovered later:

- **Dashboard aggregates are live queries.** Correct at SIHL's current volume, wrong above
  roughly a million leads. See [scaling.md](scaling.md).
- **The principal is rebuilt per request.** One indexed query per call. The fix when it
  matters is a short-TTL Redis cache keyed by session with explicit invalidation — not
  trusting the token's claims.
- **Search uses trigram indexes**, which are excellent to a few million rows and should
  become a dedicated search service beyond that.
- **The outbox has no relay worker yet.** Events accumulate correctly and are not lost; they
  are simply not yet delivered anywhere.
- **No MFA.** The schema carries `mfaEnabled`/`mfaSecret`; the flow is Phase 2 and is on the
  production checklist as a blocker for external-facing rollout.
