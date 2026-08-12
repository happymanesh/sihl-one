# ADR-0002 — SIHL ONE is a System of Engagement, not a System of Record

**Status:** Accepted · 2026-08-09

## Context

The brief is explicit: *"The application should NOT duplicate existing systems of record.
Instead, it should become the System of Engagement."* SIHL already runs a back office, a
trading terminal and a digital onboarding/eKYC platform, all of which hold regulated data.

## Decision

SIHL ONE **owns** the relationship: leads, interactions, tasks, visits, campaigns,
attribution, consent, and the engagement view of a customer.

SIHL ONE **mirrors, read-only**: holdings, client codes, KYC status, onboarding stage, ledger
figures. Every mirrored row carries `sourceSystem`, `externalRef` and `syncedAt`.

SIHL ONE **never** writes to a regulated book, and never claims to have opened an account.

## Why

A CRM that starts storing its own copy of positions becomes a second book of record. The day
it disagrees with the back office — and it will, because sync fails — someone has to decide
which number is true, in front of a regulator. Marking every mirrored row with its source
makes the answer obvious to anyone reading the table.

## Consequences

- Conversion creates a *customer* record and emits `lead.converted`. Account opening happens
  downstream; the client code comes back to us.
- The Customer 360 screen states plainly that holdings are mirrored from the back office.
- Reconciliation is a first-class Phase 2 concern: a mirror that silently stops updating is
  worse than no mirror, so `syncedAt` staleness must be alerted on.
