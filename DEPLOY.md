# Deploying SIHL ONE

Three pieces. Vercel hosts the web app only — the API is a long-running NestJS
server and Postgres is a database, so neither belongs there.

Budget 30–40 minutes if you already have the accounts. The config files are
written; what remains needs your logins.

---

## Secrets

Generate them once and keep them somewhere safe. **`PASSWORD_PEPPER` must be set
before the first user is created and never changed** — every password hash is
written with it, so changing it later locks out everyone at once.

The live values are in **`.secrets.production.local`** in the repo root, which is
gitignored. They are deliberately not written down here: an earlier revision of
this file carried them in plaintext, which put them in git history the moment it
was pushed. Those first values were burnt and replaced before any database
existed, so nothing was ever hashed with them — but the lesson stands, and this
file is the wrong home for a secret.

Mint replacements with: 

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(48).toString('base64url'));console.log(c.randomBytes(32).toString('base64url'))"
```

---

## What is actually deployed

Everything runs on Railway, in project `sihl-one`: the API, the web app and
Postgres. Vercel was the original plan for the web app and is not used — its
deploy step fails with *"Cannot patch preview comments when immutable static
file upload is enabled"*. That reproduces on CLI 53 and 58, on preview and
production, on a fresh project, and on a newer Next canary. The build succeeds
every time; only the upload fails. If Vercel fix it, `vercel.json` is still
correct and the web app can move back.

| Piece | URL |
| ----- | --- |
| Web | https://web-production-97dc7.up.railway.app |
| API | https://api-production-c405d.up.railway.app |
| Health | `/health/live`, `/health/ready` (excluded from the `/api` prefix) |

`render.yaml` is kept for reference but has never been run, and its environment
block is wrong — see below.

---

## Environment

The API validates its environment at boot with a Zod schema in
`apps/api/src/config/configuration.ts` and refuses to start if anything is
missing. **That schema is the source of truth**, not this file. An earlier
version of this document listed a single `JWT_SECRET`, which does not exist.

| Variable | Notes |
| -------- | ----- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — wired by Railway |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `sihl-one`, `sihl-one-web` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥32 chars, **must differ** — the schema rejects reuse, since a shared secret lets a stolen access token be replayed as a refresh token |
| `PASSWORD_PEPPER` | Set before the first user exists and never changed |
| `CORS_ORIGINS` | The web URL. No wildcard — rejected in production |
| `PUBLIC_WEB_URL` | Builds partner referral links and event QR codes |
| `STORAGE_LOCAL_ROOT` | `/data/storage`, on the mounted volume |
| `STORAGE_LOCAL_DURABLE` | `true`. Only honest at one replica — a volume is not shared |
| `SEED_PASSWORD` | Set this **before** the first seed, or the demo accounts get the default written in `seed.ts` |

Live values are in `.secrets.production.local`, which is gitignored. They are
not written down here: an earlier revision of this file carried them in
plaintext and pushed them.

---

## One-off data tasks

The seed and the team bootstrap run inside the container, gated on flags that
default to false:

```bash
railway variables -s api --set "SEED_ON_BOOT=true"          # or BOOTSTRAP_TEAM_ON_BOOT
# let one boot happen, watch `railway logs -s api`, then:
railway variables -s api --set "SEED_ON_BOOT=false"
```

They run there rather than from a laptop so the database never has to be
exposed on a public TCP proxy for an afternoon of setup. Both are safe to
repeat; a flag left on re-runs them on every restart.

The bootstrap prints temporary passwords **once**, into the Railway logs. Treat
those logs as sensitive and hand the passwords over individually.

---

## Gotchas that cost real time

- **`npm prune --omit=dev` strips anything the container needs at runtime.**
  The Prisma CLI, `tsx` and `dotenv` are dependencies, not devDependencies, for
  exactly this reason.
- **Prisma 7 will not migrate without a config file supplying `datasource.url`.**
  `prisma.config.ts` is TypeScript and imports `dotenv`, so the image carries
  `prisma.config.production.mjs` instead.
- **Migrations run from `apps/api/docker-entrypoint.sh`**, not from a platform
  command field. The image entrypoint is tini, which execs its arguments
  directly — a `migrate && start` string is passed through verbatim and dies
  before writing a log line.
- **Git Bash rewrites arguments that look like Unix paths.** Setting
  `STORAGE_LOCAL_ROOT=/data/storage` stored `C:/Program Files/Git/data/storage`.
  Prefix with `MSYS_NO_PATHCONV=1`.
- **`railway logs` defaults to the last *successful* deployment**, so a failing
  deploy shows stale output. Pass the deployment id.

---

## Before you widen access

- [ ] `/login` shows **no** demo accounts block (it does not — `NODE_ENV=production`)
- [ ] Sign in as one sales manager and confirm they cannot see the other team's leads
- [ ] Rotate `SEED_PASSWORD` if the demo accounts are staying reachable
- [ ] Tell everyone to leave two-step verification alone, or make sure they know
      an admin can reset it from `/admin/users`

---

## Known, and deliberately deferred

Recorded in [release readiness](docs/release-readiness.md): no penetration test,
no load testing, no DPDP retention policy, and six React components that sync
state in an effect. None block an internal test on synthetic data; all precede
real customer records.

Two more, added by this deployment:

- **Hosting region.** Railway's region decides where Indian customer records
  physically sit, which SEBI and DPDP care about. Irrelevant for synthetic data,
  not irrelevant for the first real one.
- **`tsx` ships in the production image** so the one-off tasks can run. Once the
  team exists and the book is loaded, move `tsx` and `dotenv` back to
  devDependencies and drop the two flags from the entrypoint.
