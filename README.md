# SIHL ONE

The unified digital engagement platform for **Shah Investors Home Ltd.** — one place for
marketing, lead management, CRM, onboarding hand-off, relationship management, field sales
and partner journeys.

> **Positioning.** SIHL ONE is a **System of Engagement**, not a System of Record. It owns the
> relationship — leads, interactions, tasks, visits, attribution, consent. Regulated books
> (holdings, ledgers, contract notes, KYC artefacts) stay in the back office and eKYC systems
> and are mirrored here read-only. See [ADR-0002](docs/adr/0002-system-of-engagement.md).

---

## Quick start

```bash
npm install
```

Create the database and apply the schema:

```bash
createdb sihl_one && npm run db:migrate && npm run db:seed
```

Run both apps:

```bash
npm run dev
```

| Surface        | URL                                      |
| -------------- | ---------------------------------------- |
| Web app        | http://localhost:3000                    |
| API            | http://localhost:4000/api/v1             |
| OpenAPI docs   | http://localhost:4000/api/docs           |
| Health probes  | http://localhost:4000/health/{live,ready} |

### Demo sign-ins

All seeded accounts share the password `Sihl@One2026!`. Each shows a genuinely different
slice of the same data, because the data scope is enforced server-side.

| Email                    | Role            | Sees                                  |
| ------------------------ | --------------- | ------------------------------------- |
| `admin@sihl.in`          | Super Admin     | Everything                            |
| `md@sihl.in`             | Management      | Everything, read-only                 |
| `salesmanager@sihl.in`   | Sales Manager   | Own team's pipeline; can assign       |
| `rahul.mehta@sihl.in`    | Sales Executive | Only leads they own                   |
| `marketing@sihl.in`      | Marketing       | Campaigns and attribution             |
| `ops@sihl.in`            | Operations      | Onboarding and servicing              |
| `partner@trinetrafin.in` | Partner         | Only business they sourced            |

---

## Repository layout

```
sihl-one/
├── apps/
│   ├── api/                     NestJS 11 API
│   │   ├── prisma/              schema, migrations, seed
│   │   └── src/
│   │       ├── common/          guards, filters, audit, ABAC scope, outbox
│   │       ├── config/          validated environment
│   │       ├── modules/         auth, leads, customers, activities, tasks, …
│   │       └── prisma/          PrismaService (driver adapter)
│   └── web/                     Next.js 16 App Router + Tailwind v4
│       └── src/
│           ├── app/             routes, server actions
│           ├── components/      design system and feature UI
│           └── lib/             API client, session, formatting
├── packages/
│   └── contracts/               shared enums, RBAC matrix, Zod schemas, scoring
├── docs/                        architecture, ADRs, module specs
└── .github/workflows/           CI
```

**`packages/contracts` is the spine.** Enums, the permission matrix, every validation rule,
the lead-status transition table and the scoring model live there and are imported by both
the API and the web app. There is exactly one definition of "a valid Indian mobile number"
and one definition of "which status can follow which".

---

## Commands

| Command                | Does                                              |
| ---------------------- | ------------------------------------------------- |
| `npm run dev`          | API and web together                              |
| `npm run build`        | Build contracts → API → web, in order             |
| `npm run typecheck`    | Typecheck every workspace                         |
| `npm test`             | Unit tests (contracts + API)                      |
| `npm run db:migrate`   | Create and apply a migration                      |
| `npm run db:seed`      | Reference data + demo book                        |
| `npm run db:reset`     | Drop, recreate, migrate, seed                     |

End-to-end tests need a running, seeded API:

```bash
npm run test:e2e -w @sihl-one/api
```

---

## What Phase 1 delivers

**Foundation** — npm workspaces monorepo, shared contracts package, validated configuration,
Problem Details error contract, structured request context and trace ids.

**Data** — 20 tables covering identity, org hierarchy, CRM, partners, campaigns, field visits,
documents, consent, audit and a transactional outbox. Business rules that must never be
bypassed (duplicate-lead guard, visit coherence, lost-reason requirement) are database
constraints, not just service code.

**Authentication** — Argon2id with a server-side pepper, opaque rotating refresh tokens,
per-device sessions, account lockout, uniform failure messages, full login-attempt trail.

**Authorisation** — RBAC over 38 permissions and 8 roles, plus ABAC row filtering across six
data scopes. Both are enforced on every request; the UI only hides what the API already
refuses.

**CRM** — lead capture (public and internal), duplicate detection, explainable scoring, next
best actions, status transitions with history and stage durations, assignment, bulk
assignment, conversion to customer, unified activity timeline, tasks, Customer 360.

**Web** — SIHL-branded design system in light and dark, marketing landing page with attributed
lead capture, login, role-aware dashboard, lead list, kanban pipeline, lead detail with
score explanation, Customer 360, task list, PWA manifest.

## What Phase 2 adds

**Field visits** — plan, geo check-in (GPS + selfie + timestamp), check-out, meeting notes.
Two discrete location events and nothing between them ([ADR-0007](docs/adr/0007-geo-visits-privacy.md)).
Location accuracy is required and banded; an integrity assessment flags evidence that does
not hang together, advisorily. Mobile-first UI using real geolocation and camera capture.

**Files and documents** — swappable storage driver, magic-number content sniffing, per-type
size limits, a malware-scanning seam that reports *unscanned* rather than *clean*, and
short-lived user-bound signed download grants ([ADR-0008](docs/adr/0008-storage-and-file-safety.md)).

**Partner portal** — an associate partner sees only the business they sourced: leads,
clients, conversion, attributed value and an explicitly-labelled commission *estimate*.
Settled brokerage stays with the back office.

**Outbox relay** — claims events with `FOR UPDATE SKIP LOCKED` so it is safe on every pod,
with exponential backoff, dead-lettering, and operational stats. On first boot it drained
the 34 events Phase 1 had accumulated.

**Verified** — 137 automated tests passing (53 contract, 41 API unit, 43 e2e), production
builds green for both apps, and every security boundary proven by black-box HTTP rather
than asserted in prose.

### Not built yet

Campaign builder, WhatsApp/SMS/email delivery, real eKYC and back-office integrations, MFA,
voice-note recording, offline visit capture, and the customer self-service portal. See
[docs/roadmap.md](docs/roadmap.md).

---

## Documentation

| Document                                                             | What it covers                        |
| -------------------------------------------------------------------- | ------------------------------------- |
| [Architecture](docs/01-architecture/architecture.md)                  | Structure, boundaries, request path   |
| [Security](docs/01-architecture/security.md)                          | Threat model and controls             |
| [Scaling](docs/01-architecture/scaling.md)                            | What breaks first, and when           |
| [ADRs](docs/adr/)                                                     | Decisions and their reasoning         |
| [CRM & Lead Management](docs/modules/crm-lead-management.md)          | User stories, rules, test cases       |
| [Field visits](docs/modules/field-visits.md)                          | Geo capture, privacy stance, rules    |
| [Production checklist](docs/production-checklist.md)                  | What must be true before go-live      |
| [Roadmap](docs/roadmap.md)                                            | Phase 2 onwards                       |
