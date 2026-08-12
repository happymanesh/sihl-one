# ADR-0007 — Check-in and check-out only; never continuous tracking

**Status:** Accepted · 2026-08-09

## Context

The brief asks for a geo-tagged visit module with GPS, selfie and timestamps — and states
plainly: *"Never design continuous employee tracking. Only explicit check-in/check-out."*

## Decision

The `visit` table records exactly two location events per visit and nothing between them.
There is no background location collection, no periodic ping, no route history, and no schema
in which to put one.

## Why this is a design constraint, not an unimplemented feature

Continuous tracking of employees is disproportionate under the DPDP Act's purpose-limitation
principle. The business question — *did the meeting happen, where, and for how long* — is
fully answered by two points. Collecting more would create a dataset SIHL would then have to
secure, justify, retain and eventually explain.

## How it is enforced

- Two coordinate pairs per visit and no others.
- Database check constraints: a completed visit must have both stamps, check-out cannot
  precede check-in, and coordinates must be real (rejecting `0,0` from a failed GPS fix).
- Selfies are stored as object keys, never as image data in Postgres, and are reachable only
  through short-lived signed URLs.
- Visit records feed incentive calculations, so the constraints live in the database rather
  than only in the service — an application bug must not be able to write an incoherent one.

## Consequences

- Attendance or productivity monitoring is out of scope by design. If it is ever requested it
  needs its own decision record, its own legal basis and its own consent flow — it cannot be
  quietly added to this table.
