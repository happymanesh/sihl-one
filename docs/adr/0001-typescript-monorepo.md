# ADR-0001 — TypeScript end to end, in one monorepo

**Status:** Accepted · 2026-08-09

## Context

The brief proposed .NET 8 Web API, and invited a better-justified alternative. SIHL has
7 in-house developers (2 senior), is cost-conscious, and already runs **SIHL Synapse** on
Next.js 16 + Prisma + PostgreSQL. The 2020 SSO deck proposed ASP.NET Core + SQL Server, so
the estate has .NET history.

## Decision

**NestJS 11 API + Next.js 16 web + PostgreSQL 16 + Prisma 7, in one npm-workspaces monorepo.**

## Why

1. **One language for a 7-person team.** A polyglot stack splits a small team into people who
   can fix the backend and people who can fix the frontend. At this size that is the dominant
   cost — larger than any runtime difference between .NET and Node.
2. **It matches what SIHL already runs.** Synapse is Next.js + Prisma + Postgres. Shared
   idioms, shared hiring pool, shared operational knowledge.
3. **One validation contract.** `packages/contracts` holds the Zod schemas, the RBAC matrix
   and the lead-status transition table, imported by both apps. In a split stack these are
   duplicated in two languages and drift — and drift in a *permission matrix* is a security
   bug, not a tidiness problem.
4. **It is verifiable on the machines that exist.** The development environment here has no
   .NET SDK and no Docker. .NET code would have shipped unbuilt and untested; the TypeScript
   stack was built, run, seeded and exercised end to end.

## What we give up

- Raw compute throughput on CPU-bound work. Mitigated by keeping such work out of the API:
  ML inference belongs in Python workers behind an HTTP boundary.
- .NET's stronger built-in story for long-running background services. Mitigated by BullMQ on
  Redis for Phase 2 queues.
- Any existing .NET expertise in the team is not reused for this codebase.

## Revisit if

The team's centre of gravity moves decisively to .NET, or a workload appears that genuinely
needs a CLR-class runtime. The API boundary is HTTP + OpenAPI, so a future service can be
written in any language without disturbing the web app.
