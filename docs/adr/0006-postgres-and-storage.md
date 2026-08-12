# ADR-0006 — PostgreSQL for state, object storage for files

**Status:** Accepted · 2026-08-09

## Context

The platform stores relational CRM data, JSON event payloads and score breakdowns, and binary
files (visit selfies, uploaded documents).

## Decision

**PostgreSQL 16** for all state. **S3-compatible object storage** for every binary.

## Why PostgreSQL over SQL Server

Prisma's SQL Server support lacks native JSON operations and has weaker full-text and
partial-index support. This schema depends on all three: `scoreFactors` and outbox payloads
are `jsonb`, the duplicate-lead guard is a *partial* unique index, and search uses `pg_trgm`.
PostgreSQL also removes per-core licence cost, which matters to a cost-conscious sponsor.

## Why files never go in the database

A selfie in a `bytea` column bloats backups, blows out replication and makes every `SELECT *`
expensive. Only an object key is stored; the file is served through a short-lived signed URL,
so access can be revoked and audited.

## Notable schema choices

- **Materialised path** on `org_unit` for subtree ABAC filtering.
- **`Counter` table** for human references (`LD-2026-000123`), incremented with
  `UPDATE … SET value = value + 1 RETURNING value`, which Postgres executes atomically under
  row lock. A read-then-write would race. A native sequence is marginally faster but cannot be
  reset per year per prefix without DDL.
- **`pg_trgm` GIN indexes** so `ILIKE '%asha%'` in the CRM search box is not a sequential scan
  of the whole lead table.
- **Partial indexes** on the soft-delete hot paths, since nearly every list query carries
  `deletedAt IS NULL`.
- **Money as `Decimal(18,2)`**, serialised to the client as a string so nothing does floating
  point arithmetic on a rupee value.

## Operational note discovered in Phase 1

The seed writes references directly rather than through `ReferenceService`, so it must also
advance the `counter` rows. It does — with `GREATEST`, so re-running the seed against a
database that has taken real traffic cannot rewind the counter and start reissuing references
already in use. Any future data-migration script that mints references must do the same.
