# Release readiness

Where SIHL ONE actually stands, as of 12 August 2026. Written to be read before a release
decision, not after one.

The [production checklist](production-checklist.md) is the long-form list of everything a
production system needs. This is the shorter question: **what can be released, to whom, today.**

---

## The one-line answer

**Ready for user-acceptance testing with a small internal group on synthetic data.**
**Not ready for real customer records.**

The gap between those two is not features. It is a penetration test, a dependency scan, load
testing and a data-retention policy — none of which have been done.

---

## Deployment shape

Three pieces, not one. Vercel hosts the web app only; the API is a long-running NestJS server
and does not belong on a serverless platform.

| Piece | Host |
| ----- | ---- |
| `apps/web` | Vercel |
| `apps/api` | Railway, Render, Fly, or Azure App Service |
| PostgreSQL 16 | Neon, Supabase, or RDS |

### Environment

**API**

| Variable | Notes |
| -------- | ----- |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Access tokens. The MFA challenge derives a separate key from this. |
| `PASSWORD_PEPPER` | **Set before the first user is created and never change it.** Password hashes are written with it; changing it invalidates every password in the system. |
| `PUBLIC_WEB_URL` | Used to build partner referral and event QR links |
| `NODE_ENV=production` | Makes the seed skip all demo data |

**Web**

| Variable | Notes |
| -------- | ----- |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base |
| `API_INTERNAL_BASE_URL` | Server-side calls; may be an internal address |

---

## Getting a database ready

```bash
npm run db:deploy -w @sihl-one/api        # migrations only
npm run db:seed   -w @sihl-one/api        # roles, designations, org tree; demo data skipped in production
npm run bootstrap:team -w @sihl-one/api   # report the users it would create
npm run bootstrap:team -w @sihl-one/api -- --apply
```

`bootstrap-team.ts` carries placeholder people. Edit the block marked `EDIT THIS` with real
names, emails and mobiles first. It prints temporary passwords once and flags every account
`mustChangePassword`.

Reporting lines are the part worth getting right: a sales manager's `TEAM` scope resolves to
their own direct reports, so a manager whose executives are not linked to them sees nothing,
and one linked to the wrong executives sees the wrong book. The script sets them explicitly.

---

## What is verified

**415 automated tests**, all passing: 288 in `packages/contracts`, 41 API unit, 86 end-to-end
over HTTP against a running server and a seeded database.

The e2e suites are black-box on purpose. The properties that matter here — that an out-of-scope
read returns 404 rather than 403, that a merge moves history rather than stranding it, that the
audit trail has no write path — are properties of the whole request pipeline, and a testing
module that skips a guard would assert nothing.

### Access control

- RBAC (38 permissions, 8 roles) and ABAC (6 data scopes) as two independent mandatory checks
- Scope isolation proven by signing in as different users and counting: a branch manager sees
  their branch, a zonal head their zone, an executive their own leads
- Two `TEAM`-scoped managers in the same branch verified invisible to each other
- Scope filters fail closed — no org path yields `{ id: '__no_access__' }`, not "everything"
- Org-unit moves rewrite the whole subtree in one transaction, and take effect on the next
  request because paths resolve per request rather than from the access token

### Authentication

- Argon2id with a server-side pepper; opaque rotating refresh tokens with reuse detection
- Uniform login failures, so the form cannot enumerate accounts
- TOTP two-step verification with single-use recovery codes
- The MFA challenge token is signed with a **different key** from the access token, verified by
  test to be rejected as one
- Admin MFA reset for a lost phone, which refuses to run on your own account

### Data handling

- PII masked at every read surface; the audit trail redacts on write and never un-redacts
- Audit trail append-only: no create, update or delete route exists, and all four verbs are
  asserted to 404
- Consent recorded and timestamped on every public capture
- Field visits are two discrete location events with no continuous tracking, enforced by
  database constraints (ADR-0007)

---

## What is not verified

| Gap | Severity for UAT | Severity for real clients |
| --- | ---------------- | ------------------------- |
| No penetration test | Acceptable | **Blocker** |
| 2 high advisories, assessed as not exploitable here (see below) | Acceptable | Recheck when swagger updates |
| No load or performance testing | Acceptable at ~10 users | **Blocker** |
| No DPDP retention or deletion policy | Acceptable on synthetic data | **Blocker** |
| MFA enrolment and login-challenge screens never clicked through | Low — API fully tested | Should be done |

### Static analysis and dependencies

`npm run lint` passes across all three workspaces — flat ESLint 9 configs with type-aware
rules (`no-floating-promises`, `no-misused-promises`, `no-explicit-any`), plus Next's own
App Router rules on the web app. The first run found and fixed: nine dead imports left over
from the enum→master refactor, a dead `context` variable left when `login()` was split for
MFA, and five async handlers passed straight to DOM attributes where a rejection would have
gone unnoticed. **No floating promises in either app's source** — the rule most likely to
find a lost database write found nothing.

74 warnings remain, all advisory: 68 non-null assertions and 6 `react-hooks/set-state-in-effect`.

The React ones are **real, not false positives**. Six components sync local state to the URL
inside an effect, which costs an extra render pass and can cascade. The correct fix is to
adjust state during render instead; it touches six working, verified components, so it is
recorded as a warning to migrate rather than silenced.

**`npm audit`: 2 high, both `js-yaml` reached through `@nestjs/swagger`.** Assessed and
accepted rather than fixed, because it cannot be fixed cleanly and does not apply here:

- `@nestjs/swagger@11.4.6` is the latest release and pins `js-yaml` to exactly `5.2.1`, so npm
  `overrides` will not move it — three forms were tried and none took
- The advisory is a denial of service when **parsing** attacker-controlled YAML. Swagger uses
  js-yaml to *serialise* the OpenAPI document
- Swagger is not mounted in production at all (`if (!config.isProduction)` in `main.ts`)

Recheck when `@nestjs/swagger` ships a release that unpins it.

### Where performance will hurt first

Not guesses — these are known shapes in the code, invisible at the seeded 66 leads and not at
50,000:

- `PerformanceService.standingFor` rates every peer individually; a 50-person team is roughly
  200 queries
- `AllocationService.candidates` scores candidates sequentially, deliberately, to avoid
  exhausting the connection pool — which trades latency for safety
- Duplicate detection is N+1: one grouped query, then one fetch per group
- `MastersService.listProducts` runs a lead count per product, because `productInterest` is an
  array column with no relation for Prisma to `_count`

---

## Pre-flight before anyone logs in

1. Deploy all three pieces and set the environment above
2. `NODE_ENV=production` on the API — confirm the login page no longer lists demo accounts
3. Run migrations, then the seed, then `bootstrap:team` with real people
4. Confirm no lead in the database carries a dialable mobile

On the last point: the demo book uses `90000xxxxx`, sequential and unmistakable. India has no
reserved fictional-number range, so the protection cannot be that the numbers are unroutable —
it is that no human mistakes them for real. The original generator produced `97xxxxxxxx`
numbers that would have been answered by a stranger, and six salespeople told to try a new CRM
will eventually press call. `npm run clean:test-data -w @sihl-one/api` reports before it
changes anything.

---

## What testers can and cannot exercise

**Can:** leads, pipeline, customers and onboarding, tasks, field visits with check-in and
check-out, bulk import, duplicate review and merge, the partner portal and referral links,
event QR capture, campaigns and attribution, the performance scorecard and coaching, the
product catalogue, the audit trail, and the source, product, org-unit and user masters.

Four products — equity, F&O, mutual funds and IPOs — carry full catalogue content. The other
eight have names only and show a plain "nobody has written this yet" message rather than an
empty page; an administrator fills them in under Sources and products.

**Cannot, because it does not exist:**

- **Actual message delivery.** Templates, the consent/DND/quiet-hours gate, rendering and the
  message log are built and tested; the `MessageSender` port has one implementation that records
  and sends nothing. No provider is wired, because SIHL has no credentials yet and a half-wired
  adapter nobody can exercise looks finished until a client fails to receive something. Binding
  a real provider is one line in `MessagingModule`.
- **eKYC and back-office integration.** Conversion emits `lead.converted` carrying the partner,
  campaign and event attribution — the mapping a partner is paid on — but nothing consumes it.
- **Offline visit capture** and voice notes.

---

## Sequencing after UAT

1. ESLint configuration and a dependency scan — the cheapest security work available, and it
   has never run
2. Load testing against a realistic dataset, starting with the four shapes listed above
3. Penetration test
4. DPDP retention, deletion and export policy; audit-log partitioning
5. Message delivery, on which cross-sell, retention and AI engagement all depend
