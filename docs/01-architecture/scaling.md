# Scaling — what breaks first, and when

Written so the team knows where the cliffs are before it drives off one. Order is by
expected arrival, not by severity.

## Current shape

Single API process, single Postgres, no cache. That is the right shape for SIHL's current
volume, and the sections below say when each part stops being right.

| Assumption                | Comfortable to      | First symptom                                  |
| ------------------------- | ------------------- | ---------------------------------------------- |
| Live dashboard aggregates | ~1M leads           | Dashboard slows, then times out                |
| Trigram search            | ~2–5M rows          | Search latency climbs; index size grows        |
| Per-request principal load| ~500 req/s per pod  | Extra query dominates p99                      |
| pg pool of 20 per pod     | ~10 pods            | `too many connections` under load              |
| Synchronous outbox writes | High                | Not a bottleneck; the *relay* is               |

## 1. Dashboard aggregates

`DashboardService.overview()` runs ~16 counts plus two groupings on every load. Each is
indexed and scoped, but they are live queries over the whole lead table.

**Breaks at** roughly a million leads, or sooner if many managers load the dashboard at 9am.

**Fix, in order of cost:**
1. Cache per (user, scope) in Redis for 60 seconds. Most of the value, almost no complexity.
2. Materialised views refreshed on a schedule for company-wide figures.
3. A read replica for analytics traffic.

Do **not** reach for a warehouse first. At SIHL's volume that is more moving parts than the
problem justifies.

## 2. Principal resolution per request

Every authenticated request re-reads the user, roles, org unit and session. That is a
deliberate trade (ADR-0004): it makes revocation immediate.

**Breaks at** high request rates, where the extra round-trip shows up in p99.

**Fix:** a short-TTL (30–60s) Redis cache keyed by `sessionId`, invalidated explicitly on
role change, session revocation and status change. **Not** by trusting the token's claims —
that would give back exactly the staleness the design set out to avoid.

## 3. Search

`pg_trgm` GIN indexes serve `ILIKE '%fragment%'` well into the low millions of rows.

**Breaks at** a few million leads plus customers, or when search needs ranking, synonyms or
cross-entity results.

**Fix:** a dedicated search service (OpenSearch/Meilisearch) fed from the outbox, so the
index is eventually consistent by construction rather than by a nightly job nobody watches.

## 4. Connection pool

Each pod opens up to 20 connections. Postgres defaults to 100.

**Breaks at** ~5 pods with headroom, or immediately if someone scales to 10 without changing
anything — pods then starve each other.

**Fix:** PgBouncer in transaction mode. Note that transaction pooling disallows session-level
features; Prisma is compatible, but prepared-statement behaviour must be verified before the
switch.

## 5. Outbox relay

Events accumulate correctly today and are never lost. There is no relay worker yet, so
nothing is delivered.

**Breaks at** the moment a real integration goes live.

**Fix:** a worker that claims unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes, and
stamps `publishedAt`. Needs exponential backoff, a dead-letter path after N attempts, and an
alert on queue depth. Consumers must be idempotent: the relay guarantees at-least-once, and
exactly-once across a network is not available at any price.

## 6. Audit table growth

Every read of a lead or customer writes a row. At 200 RMs × 100 record views a day that is
~20,000 rows/day, ~7M/year.

**Breaks at** a few years — as a storage and query-latency problem, not correctness.

**Fix:** monthly partitioning by `createdAt`, with older partitions moved to cheaper storage.
Retention must respect the regulatory minimum (typically 8 years), so this is archival, not
deletion.

## What is already right

- Every list endpoint is paginated with a hard cap of 100.
- Scope filters are indexed range scans, not recursive walks.
- Lead scores are persisted, so sorting and filtering by score happens in the database.
- Kanban columns are loaded independently with grouped counts, so a column with 4,000 leads
  costs the same as one with four.
- Charts are server-rendered where they are static markup, so no chart library ships to the
  browser for the source breakdown.
