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

```
JWT_SECRET      = JqDJVtN22vAc-pGlwRPOCUX2TiUclemTL8Nw8f1Hz14GbxfPIE56zZwO_BxDYG5i
PASSWORD_PEPPER = LuO6wfdbNX0nCa_HxTQ-YIwyoBNAat9H-Hwinsl4lG4
```

Those two were generated for this deployment. If they have appeared in a chat
log, a ticket, or an email, treat them as burnt and mint new ones:

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(48).toString('base64url'));console.log(c.randomBytes(32).toString('base64url'))"
```

---

## 1. Push the code

The repository was initialised locally but has no remote.

```bash
git remote add origin https://github.com/<you>/sihl-one.git
git branch -M main
git push -u origin main
```

Make it **private**. It carries the full data model and every access rule.

---

## 2. Database — Neon

Create a project, copy the pooled connection string. That is `DATABASE_URL`.

---

## 3. API — Render

`render.yaml` in the repo root is a blueprint: New → Blueprint → pick the repo.
It builds `apps/api/Dockerfile` and provisions Postgres alongside, so skip step 2
if you use it.

Set these in the dashboard (the blueprint marks them `sync: false` so they never
live in the repo):

| Variable | Value |
| -------- | ----- |
| `JWT_SECRET` | from above |
| `PASSWORD_PEPPER` | from above |
| `PUBLIC_WEB_URL` | your Vercel URL — you will not have it yet, see step 5 |

`NODE_ENV=production` and `DATABASE_URL` are set by the blueprint. Production
mode turns Swagger off and suppresses verbose errors.

Health check: `https://<api>.onrender.com/health/live` should return
`{"status":"ok"}`.

---

## 4. Web — Vercel

Import the repo. `vercel.json` sets the build; Vercel detects Next.js.

| Variable | Value |
| -------- | ----- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<api>.onrender.com/api/v1` |
| `API_INTERNAL_BASE_URL` | the same |

Vercel sets `NODE_ENV=production` itself, which is what hides the demo-account
block on the login page.

---

## 5. Close the loop

The two services need each other's URLs, so one of them has to go second: set
`PUBLIC_WEB_URL` on Render to the Vercel URL now and redeploy the API. It is used
to build partner referral links and event QR codes — wrong, and those links point
nowhere.

---

## 6. Load the database

Run these locally with `DATABASE_URL` pointing at the deployed database.

```bash
DATABASE_URL="<neon-url>" npm run db:deploy -w @sihl-one/api
DATABASE_URL="<neon-url>" NODE_ENV=development npm run db:seed -w @sihl-one/api
```

`NODE_ENV=development` on the **seed** is deliberate and is the one
counter-intuitive step. The seed skips demo data under `NODE_ENV=production`, and
you want the demo book — 66 leads across every pipeline stage — so testers have
something to react to in week one. It does not affect how the API runs; that
stays `production`.

Every demo mobile is `90000xxxxx`, sequential and unmistakably synthetic. That is
deliberate: India has no reserved fictional-number range, so the protection is
that no human mistakes them for real. Give six salespeople a CRM full of leads
and one of them will press call.

---

## 7. Create the real users

Edit the block marked `EDIT THIS` in `apps/api/prisma/bootstrap-team.ts` with
real names, emails and mobiles first.

```bash
DATABASE_URL="<neon-url>" PASSWORD_PEPPER="<pepper>" npm run bootstrap:team -w @sihl-one/api
DATABASE_URL="<neon-url>" PASSWORD_PEPPER="<pepper>" npm run bootstrap:team -w @sihl-one/api -- --apply
```

Run it without `--apply` first: it prints exactly who it would create, with roles,
scopes and reporting lines, and writes nothing. With `--apply` it prints temporary
passwords **once**.

The reporting lines are the part worth checking. A sales manager's `TEAM` scope
resolves to their own direct reports, so a manager whose executives are not linked
to them sees nothing, and one linked to the wrong executives sees the wrong book.

Hand the passwords over individually, not in a group chat. Every account is
flagged `mustChangePassword`.

---

## Before you send the link

- [ ] `https://<vercel-url>/login` shows **no** demo accounts block
- [ ] Sign in as your admin and load `/leads` — the demo book is there
- [ ] Sign in as one sales manager and confirm they cannot see the other team's leads
- [ ] Tell everyone to leave two-step verification alone for now, or make sure
      they know an admin can reset it from `/admin/users`

---

## Known, and deliberately deferred

Recorded in [release readiness](docs/release-readiness.md): no penetration test,
no load testing, no DPDP retention policy, and six React components that sync
state in an effect. None of these block an internal test on synthetic data; all
of them precede real customer records.
