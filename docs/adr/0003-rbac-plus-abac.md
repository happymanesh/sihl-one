# ADR-0003 — Permissions for actions, data scopes for rows

**Status:** Accepted · 2026-08-09

## Context

Seven distinct audiences share one platform: customers, sales executives, sales managers,
partners, marketing, operations, management, plus super admin. They differ both in *what they
may do* and in *which records they may see*.

## Decision

Two independent checks, both mandatory:

- **RBAC** — 38 fine-grained permissions (`lead:assign`, `audit:read`, …) bundled into roles.
  Guards check permissions, never roles.
- **ABAC** — six data scopes (`ALL/ZONE/REGION/BRANCH/TEAM/SELF`) compiled into a Prisma
  `where` fragment composed into every query.

Effective scope is `min(role default, user record)` — a user record can narrow, never widen.

## Why

**Permissions, not roles, in guards.** `@Roles('SALES_MANAGER')` makes every future org
redesign a code change. `@RequirePermissions('lead:assign')` makes it a configuration change.

**Roles are seeded from code into the database.** The code matrix is the readable statement of
intent and what tests assert against; the `role` row is what the guard reads at runtime.
Compliance can re-cut who-can-do-what without a deployment.

**No deny rules.** Anything a role should not do is simply absent. Deny rules interacting with
inheritance is the classic source of "why can this person see that" incidents.

**Materialised path for subtrees.** Hierarchy changes a few times a year; list queries run
constantly. A `startsWith` on an indexed varchar beats a recursive CTE per request.

## Consequences

- Every repository method must compose the scope filter. This is enforced by e2e tests that
  assert an out-of-scope record returns 404 on read **and** 404 on write.
- Out-of-scope records return **404, not 403**. A 403 confirms the record exists.
- A hierarchy-scoped user with no org unit gets `{ id: '__no_access__' }` — fail closed.

## The incident this ADR exists to prevent

During Phase 1 a decorator bug bound the request body to parameter index 0 — the
`@CurrentUser()` slot — on every write handler. The principal was replaced by the payload,
`dataScope` became `undefined`, and the filter degraded to `{ ownerId: undefined }`, which
Prisma treats as *no condition*. Reads stayed correctly locked down while **writes were
completely open**: a sales executive could disqualify a lead they could not even read.

Two lessons are now encoded in the codebase:

1. A decorator must never guess a parameter position. Positions are the caller's business.
2. Authorisation tests must exercise write paths, not only reads. A read-only suite gave a
   clean bill of health while the system was wide open.
