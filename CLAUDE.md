# CLAUDE.md

Guidance for Claude Code working in this repository.

**SIHL ONE** is the engagement platform for **Shah Investors Home Ltd**, a
SEBI-registered Indian stockbroker. It is in production and a live sales team
uses it daily. Read the constraints below before changing anything.

---

## Standing constraints — read these first

These are the product owner's standing instructions. They are not negotiable
defaults, and they override any convenience the code might suggest.

1. **Never deploy without being asked.** Not to Railway, not to Vercel, not to
   staging, not to production. "It builds" is not permission. Each environment
   needs its own explicit instruction, and approval for staging is never
   approval for production.
2. **The production database holds live client data.** The sales team ran a CUG
   (closed user group) on real leads and never stopped. Nothing may be deleted
   or modified there without being asked. When clearing demo data, delete only
   the seeded dummy records and retain everything the team entered.
3. **Never push without being asked.** Committing locally is fine; publishing
   is a separate decision.
4. **No continuous employee tracking, ever.** Location is captured only at an
   explicit check-in and check-out. Do not add background location, periodic
   pings, or anything that follows a rep through their day — see
   `docs/adr/0007-geo-visits-privacy.md`.
5. **The browser never talks to a database.** The web app calls the API; the API
   owns Postgres. There is no exception to this.

---

## The one architectural idea that explains everything

**This is a system of engagement, never a system of record** —
`docs/adr/0002-system-of-engagement.md`.

Brokerage, ledgers, holdings and payouts live in the back office. This system
records *interactions*: who spoke to whom, what was promised, what was visited,
what was converted. Therefore **every money figure the app computes is an
estimate entered by a rep**, and must be labelled as one wherever it is shown.
Never reconcile it against the back office, never present it as revenue, and
never build a feature that implies the app knows what a client is actually
worth.

If a change would make this app the authority on a financial fact, it is the
wrong change.

---

## Commands

```bash
npm run dev              # api on :4000 and web on :3000 together
npm run dev:api          # just the API
npm run dev:web          # just the web app

npm run build            # contracts, then api, then web (order matters)
npm run typecheck        # all workspaces
npm run lint             # all workspaces
npm test                 # all workspaces

npm run db:migrate       # prisma migrate dev
npm run db:generate      # regenerate the Prisma client
npm run db:seed          # demo data
npm run db:reset         # destructive; local only
```

npm workspaces, **not** pnpm. Node >= 20.11.

API tests: `npm test -w @sihl-one/api` runs `test/unit/*.test.ts` with the
built-in node test runner. `npm run test:e2e -w @sihl-one/api` needs a running
API and honours `E2E_BASE_URL`. **The web app has no test harness** — that is a
known gap, not an oversight to work around by inventing one mid-task.

---

## Shape

Three workspaces under `packages/*` and `apps/*`:

- **`packages/contracts`** — Zod schemas, enums, the RBAC matrix, and business
  rules as *pure functions*. Both other packages import it. If a rule can be
  expressed without touching the database, it belongs here where it can be
  tested in isolation — `rollUpLeadStatus`, `notificationsFor`,
  `canRescheduleVisit`, `rate`. See `docs/adr/0005-shared-contracts.md`.
- **`apps/api`** — NestJS 11, Prisma 7, PostgreSQL 16. 28 feature modules
  under `src/modules/`.
- **`apps/web`** — Next.js 16 App Router, React 19. Server Components by
  default; `"use client"` only where there is real interactivity.

**Build contracts first.** The other two import its compiled output, so a
contracts change that is not rebuilt produces type errors that look like they
come from elsewhere.

### How a request actually flows

```
browser → Next server (route handler or server action) → API → Postgres
```

The browser never calls the API directly. The access token lives in an httpOnly
cookie, which is the entire point — so anything the browser needs goes through a
same-origin route handler in `apps/web/src/app/api/**` that attaches the token
server-side. `apps/web/src/lib/api.ts` (`apiFetch`) does the same for server
components and actions.

A consequence worth remembering: **the API sees the Next server as its caller**,
not the browser. `apps/web/src/lib/forwarded.ts` therefore forwards the real
client IP and a per-request trace id on every outbound call. If you add a new
web → API call site, include `...(await forwardedHeaders())` or the audit trail
will record the wrong address.

### Authorisation: RBAC and ABAC together

`docs/adr/0003-rbac-plus-abac.md`. Two independent questions:

- **What may this person do?** 8 roles, 37 permissions. Checked with
  `@RequirePermissions('lead:read')`.
- **Whose data may they see?** 6 scopes — ALL, ZONE, REGION, BRANCH, TEAM, SELF
  — applied as a Prisma `where` fragment from `ScopeService`.

Both are **rebuilt from the database on every request**, never carried in the
token, so a revoked session or changed role takes effect immediately rather than
at the next refresh.

This is why there is rarely a "manager version" of anything. One endpoint serves
the whole hierarchy: a rep sees their own row, a manager their branch, the
national head everything. `apps/api/src/modules/reports/` is the clearest
worked example.

`JwtAuthGuard` is a **global** guard. Routes opt *out* with `@Public()`, so
forgetting a decorator locks a door rather than opening one. The exception is
`@AllowServiceAccount()`, which is opt-*in*: machine keys reach only the
endpoints someone deliberately listed.

### Events

A transactional outbox (`OutboxEvent`), relayed every 5s in batches of 50, 8
attempts with backoff, then dead-lettered. Events are written **in the same
transaction as the state change** — without that, a crash between commit and
publish silently loses a lead assignment. Consumers implement `EventPublisher`.

---

## Traps that have actually cost time here

Not hypothetical. Each of these has bitten at least once.

- **A stale API process serving old code.** Twice, a feature "didn't work" and
  the real cause was a previous `node dist/main.js` still holding the port and
  consuming events with old logic. Before concluding a change is broken, check
  what is actually listening: `netstat -ano | grep :4000`. On Windows,
  `taskkill` sometimes reports "not found" for a PID `netstat` still shows —
  use PowerShell `Stop-Process -Id <pid> -Force`.
- **Prisma migrations are not transactional.** A multi-statement migration that
  fails halfway leaves earlier statements applied and the migration marked
  failed. **Every migration must be idempotent** — `CREATE TABLE IF NOT
  EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, guarded `ALTER`. This has
  broken the deploy more than once.
- **`en-GB` renders September as "Sept".** Four letters, which breaks any fixed
  `dd-mmm-yy` format. Where a month name must be exactly three letters, map it
  from the month number and delegate only the timezone to `Intl`.
- **Timezone.** The server clock is UTC; every user is in India. Anything a
  person reads must be rendered in `Asia/Kolkata`, or a 09:00 event reports as
  03:30 and reads as a different record entirely.
- **Next.js dev and a production build share `.next`.** Running `next build`
  and then `next dev` can leave newly added routes 404ing in dev while the
  production manifest contains them. `rm -rf .next` and restart.
- **Typed routes.** A newly created page is not in the generated `Route` union
  until a build regenerates it; existing code casts (`'/x' as Route`).
- **Scoring counts only human activity.** `isSystemGenerated: false` must be
  applied wherever activities are counted. A period where it was missing in one
  path meant the same lead scored differently depending on which code path last
  recalculated it.

---

## Conventions

- **Money** is `Decimal(18,2)` in Postgres and a **string** in and out of the
  API. Never a float.
- **Nothing a regulator might ask about is hard-deleted.** Soft-delete with
  `deletedAt`, or revoke with a timestamp. Notifications are the deliberate
  exception — they are reminders, not records, and are purged on retention.
- **A rate with no denominator is `null`, not `0`.** A rep with nothing assigned
  has no conversion rate, and 0% would sort them below people who genuinely
  failed. These tables get read in appraisals.
- **Audit**: `AuditService.record` never throws — an audit failure must not fail
  the user's work — but it logs loudly. `actorId` is a foreign key into
  `app_user`, so a service account writes `null` there and identifies itself
  through `actorLabel`.
- **Errors** are RFC 7807 problem+json. The web surfaces `problem.detail`, so
  that string is user-facing copy: write it for the person who hit it, and say
  what they should do next.
- Comments explain **why**, not what. Several in this codebase record a decision
  and the alternative rejected — keep that habit; it is what makes the reasoning
  survivable.

---

## Deploying

Everything runs on **Railway**, project `sihl-one`, environments `production`
and `staging`. There is no GitHub integration: every deploy is a deliberate act.

```bash
railway up --environment staging --service api --ci
railway up --environment staging --service web --ci
```

- **Only when explicitly asked.** See constraint 1.
- Migrations run automatically: `apps/api/docker-entrypoint.sh` executes
  `prisma migrate deploy` before the server starts, so a healthy container is
  evidence the migration applied.
- The CLI may be linked to the wrong environment or service — **always pass
  `--environment` and `--service` explicitly.**
- `railway up` sometimes times out streaming logs after the build was accepted.
  **Do not re-run it** — that starts a second build. Poll the endpoint instead.
- **Take a backup before any schema change on production**:
  `scripts/backup-production.sh`. It dumps inside the Postgres container,
  verifies by restoring into a scratch database, compares row counts, and cleans
  up either way. Railway's managed backups are a Pro feature; this project is on
  Hobby, so this script is the only safety net.
- Vercel is **not** used for the web app. Its upload step fails; `vercel.json`
  is kept in case that is fixed.

---

## Environment and secrets

The API validates its environment at boot with a Zod schema in
`apps/api/src/config/configuration.ts`. **That schema is the source of truth**
for what is required — not any document, including this one.

`PASSWORD_PEPPER` must be set before the first user exists and **never
changed**: every password hash is written with it, so changing it locks out
everyone at once.

**Never put a credential in a tracked file.** `docs/readmeref.txt` currently
carries live vendor keys in plaintext and is committed — that is a known
outstanding problem to be cleaned up, not a pattern to copy.

---

## Known gaps

Stated plainly so they are not rediscovered as surprises: no penetration test,
no load testing, no DPDP retention policy, no consent ledger, and no web-layer
test coverage at all. The `Leads` export sheet is capped at 20,000 rows.
