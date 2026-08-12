# Roadmap

**Phases 1–5 are built and verified.** 415 tests pass: 288 contract, 41 API unit, 86 end-to-end
over HTTP. See [release readiness](release-readiness.md) for what can be released and to whom —
the short version is that this is ready for internal UAT on synthetic data, and not yet for
real customer records.

What follows is sequenced by dependency and by value, not by the order the modules appear in
the brief.

## Phase 1 — Foundation and CRM core ✅

Monorepo, shared contracts, data model, authentication, RBAC + ABAC, audit, outbox, design
system, landing page with attributed capture, login, dashboards, lead management, Customer
360, tasks.

---

## Phase 2 — Field sales and partners ✅

- Visit planner, check-in/check-out with GPS + selfie + timestamp (ADR-0007 constraints)
- Location accuracy banding and an advisory integrity assessment
- Storage driver abstraction, magic-number sniffing, scanning seam, signed download grants
- Document upload against leads, customers and partners
- Partner portal and Partner 360, with earnings labelled as estimates
- Outbox relay worker with backoff, dead-lettering and operational stats

### Deferred out of Phase 2, with reasons

- **MFA.** Self-contained but it changes the login flow into two steps, which deserves its
  own slice rather than being bolted on at the end of a large one. Still a production
  blocker.
- **Voice notes.** The storage path and the `voiceNoteKey` column exist; recording UI and
  transcription do not. Low value until there is somewhere for the transcript to go.
- **Offline visit capture.** The single most valuable remaining field-sales feature, and the
  one with real design weight: it needs an IndexedDB queue plus idempotency keys on check-in
  and check-out so a replayed submission cannot create a second event. Doing it badly is
  worse than not doing it.

---

## Phase 3 — Lead supply, ownership and performance

**3A — Lead supply ✅**

- Bulk import: delimiter and encoding detection, column mapping with suggestions, per-row
  validation, a mandatory lawful-basis declaration, and a reversible batch
- Duplicate detection on identity keys with a scored match and a suggested decision

**3B — Ownership ✅**

- Assignment rules engine (round robin, load balanced, fixed owner, leave unassigned), used
  by import, capture and offboarding alike so routing cannot drift between them
- Offboarding handover with a preview of what actually moves
- Sales hierarchy: designations as data, reporting-line validation, and the three
  privilege-escalation guards

**3C — Performance, coaching and allocation ✅**

- Quality-adjusted rating with empirical-Bayes shrinkage, fully explainable
  ([ADR-0009](adr/0009-rating-drives-advice-not-allocation.md))
- Behaviour metrics scored separately from outcomes; coaching nudges derived only from them
- Targets per person per period, with pacing rather than raw attainment
- Rep standing: percentile band, team median, gap to top — never a ranked list
- Smart allocation in **recommend mode**, with eligibility filters, capacity limits, a
  behaviour gate and a development floor

**3D — Coded public capture ✅**

- Events with a per-event QR: create, open for scans, close. A scan opens a registration form
  already tagged to the event and routed to whoever is running it
- Partner referral links: an opaque, rotatable code per partner, with a QR on their portal
- **Sourcing now reaches the back office.** `lead.converted` carries `partnerId`,
  `partnerReference`, `partnerReferralCode`, `campaignId` and `eventId`, so an activated
  account maps to the partner who introduced it. The link existed internally but stopped at
  the CRM boundary
- Codes are resolved server-side from the code alone — the unauthenticated capture endpoint
  never accepts a partner or event **id** from the browser

**3E — Duplicate review and merge ✅**

- `/leads/duplicates`: leads sharing an exact mobile, email or PAN, grouped and scoped
- A merge only ever *adds* — a field already filled on the survivor is never overwritten, and a
  value the merge keeps out is reported rather than dropped
- Nothing is deleted: the duplicate is closed as `DISQUALIFIED / DUPLICATE` and points at the
  survivor. Notes, tasks, documents and consent move across in one transaction
- A converted lead can only ever be the survivor — it has a customer behind it that may already
  carry a back-office client code

Phase 3 is now complete.

---

## Phase 4 — Partners, campaigns and governance ✅

The three nav destinations that had shipped as disabled "Soon" chips
([module doc](modules/marketing-and-governance.md)).

- Partners directory and staff-side Partner 360, sharing the partner portal's own endpoint
  and its estimate labelling
- Campaigns as a unit of spend: lifecycle, budget, recorded spend, generated tracking links
- **The attribution loop actually closed** — `utm_campaign` now resolves to a campaign on both
  lead-creation paths, case-insensitively. It was captured as a string and never resolved, so
  every campaign report would have read zero
- Cost per lead and per acquisition, null rather than zero when spend is unknown; business won
  published as a scale ratio and never as a return on spend
- Audit trail read API and screen: search, date range, security-only view, field-level diffs,
  and no write path in either the application or the database role

---

## Phase 5 — Configurability and communications

**Org hierarchy admin ✅** — `/admin/org-units`, admin-only. Open a branch, region or zone;
rename; deactivate; move a unit to a different parent. Placement rules are enforced (a zone
cannot sit under a branch), cycles are refused, and a move rewrites the whole subtree's
materialised path in one statement inside a transaction. Moving is separated from renaming and
carries a mandatory audited reason, because it changes who can see whose records — and because
paths resolve per request rather than from the access token, that change is live immediately.

**Source and product masters ✅** — both were Postgres enums, so "add a source" meant a
developer and a deploy. Now editable tables, admin-only (`system:configure`, held by
SUPER_ADMIN alone). Shipped rows are permanent but relabellable and deactivatable; a new source
must state its scoring weight; the scorer reads that weight from the master. Migration
converted 163 leads in place with no data loss.

**Product catalogue ✅** — `/products`, for anyone who can read leads. Written to be read aloud
across a desk: benefits as scannable lines, charges in their own block labelled indicative
because the back office owns pricing, and SEBI risk wording given its own card rather than a
footnote. Content is authored by an administrator in the product master; the screen invents no
numbers of its own.



**MFA ✅** — TOTP two-step verification, with an admin reset for a lost phone and spent
recovery codes. The reset refuses to run on your own account: `disable` proves both factors,
reset proves neither, so self-service would let a hijacked admin session shed MFA without the
password. It revokes the subject's sessions and is audited with a mandatory reason.

TOTP two-step verification. Enrolment with a locally rendered QR, single-use
recovery codes, and a challenge step in the login flow signed with a key separate from the
access token, so a half-finished sign-in can never act as an authenticated one.

- Offline visit capture and voice notes (still deferred)
- Audience builder, landing pages and forms on top of the campaigns now in place
**Messaging spine ✅** — templates with `{{variable}}` substitution, a message log that records
suppressed messages with their reason, and the compliance gate: TRAI DND, the 21:00–09:00 quiet
window, DPDP marketing consent, and per-channel opt-out. Transactional messages are exempt from
DND and quiet hours but never from an opt-out. `MessageSender` is a port with a recording
adapter; a provider binds behind it.

- WhatsApp Business, SMS and email adapters behind the `MessageSender` port (needs credentials)
- Journey automation and A/B testing
- Partner create and edit screens (the schemas exist; only the read path has UI)
- Audit trail retention, partitioning and an approval-gated export

## Phase 6 — Integrations and onboarding

- Back-office adapter and reconciliation
- eKYC: PAN verification, CKYC, Digilocker, bank verification, e-sign
- Trading terminal SSO and holdings sync
- API gateway, service-to-service auth, per-integration circuit breakers

## Phase 7 — Intelligence

Deliberately last, because it needs the data the earlier phases produce.

- Replace the rules engine with trained models behind the same interface
  (`ScoringFeatures` → `LeadScore`), keeping factor-level explanations
- Churn prediction, segmentation, product recommendation
- Sales and partner copilots
- Conversation summarisation and voice-to-notes
- Natural-language query over the CRM
- Predictive management dashboards

Build on the Claude API rather than home-grown models — the differentiator is SIHL's data and
workflow, not model training.

## Phase 8 — Customer self-service

- Customer portal: onboarding tracking, product access, service requests, referrals
- Trading terminal hand-off
- Consent and privacy self-management (DPDP data-principal rights)

---

## Identity convergence

ADR-0004 keeps SIHL ONE's token handling behind one service so Synapse can become the issuer
for internal users without touching anything else. That switch should happen once Synapse is
stable in production — ideally during Phase 2, before the user base grows.

Customers and partners keep local authentication permanently; they will never exist in an
HR-sourced directory.
