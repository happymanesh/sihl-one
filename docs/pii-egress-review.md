# PII egress review — SIHL ONE

**Reviewed:** 12 September 2026 · **Scope:** every path by which personal data can leave the
system · **Method:** source review plus live probes against a running API and a seeded database.

SIHL ONE holds name, mobile, email, PAN, city and address for leads, customers, partners and
event captures. It is a System of Engagement — no orders, trades, settlement or demat — so this
review is organised around that personal data rather than around trading records.

Nothing in this review changed application behaviour. Findings are recommendations.

---

## Summary

| # | Finding | Severity | Type |
|---|---|---|---|
| 1 | Public capture endpoint confirms whether a mobile number is a known lead | Medium-high | Disclosure |
| 2 | Unauthenticated writes to existing lead records | Medium | Integrity |
| 3 | Import staging retains rejected people indefinitely | Medium | Retention / DPDP |
| 4 | The only retention routine in the codebase is never called | Medium | Retention / DPDP |
| 5 | Marketing can export the entire book unmasked | Decision needed | Policy |
| 6 | Documents answer 403 where leads answer 404 | Low | Disclosure |

Six controls were checked and found sound; they are recorded at the end because an auditor will
ask about them and the evidence is easier to produce now than later.

---

## 1. The public capture endpoint confirms whether a mobile number is a known lead

**Severity: medium-high.** `POST /leads/capture` is unauthenticated by design — a prospect
scanning a QR code at a stall has no account. Its response differs depending on whether the
mobile number supplied is already an open lead.

Observed directly against a running API:

```
existing lead mobile   HTTP 201  {"reference":"LD-2026-000252","duplicate":true}
unknown mobile         HTTP 201  {"reference":"LD-2026-000253","duplicate":false}
```

So anyone who can reach the API can ask, of any Indian mobile number, *is this person an open
SIHL prospect* — and receives the existing lead's internal reference when the answer is yes.
For a broker that is commercially sensitive and, under DPDP, a confirmation of personal data to
an unauthenticated party. The reference number additionally supports social engineering
("calling about your enquiry LD-2026-000123").

Rate limiting is 10 requests per minute per IP (`@Throttle` on the route), which is roughly
14,000 numbers per day from a single address and trivially parallelised.

**The intent is already correct, and enforced in the wrong layer.** The web capture page
deliberately shows the same confirmation either way, with this comment in
`apps/web/src/app/actions/lead-capture.ts`:

> The same confirmation either way. Telling an anonymous visitor "we already have you on file"
> would confirm to anybody with a phone number whether that person is a SIHL prospect.

That reasoning is right. But the control lives in the client, and the API is reachable on its
own hostname, so calling the API directly bypasses it.

**Confirmed 12 September 2026:** the API does have its own public domain in production
(`api-production-c405d.up.railway.app`), so this is reachable from the internet today. The
severity stands.

**Decided 12 September 2026 — drop the reference from the public response entirely.**

The visitor is currently shown "Your reference is LD-…" after submitting. That line goes. An
opaque acknowledgement id would preserve it, but needs a lookup table and a way for staff to
resolve one, which nobody has asked for.

Keeping a reference for new leads only does not work: references are sequential, so submitting
an unknown number twice and receiving the same number back rather than the next one answers the
question even with the `duplicate` flag removed. The reference has to go.

**Scheduled for after 27 September 2026.** This is the capture path the live event runs on, and
a disclosure issue that has been present for months does not justify touching that path days
before the event. To be implemented with an end-to-end QR scan test on staging before it reaches
production.

## 2. Unauthenticated callers can write to existing lead records

**Severity: medium.** On the duplicate branch, the same public endpoint — with no token —
writes to an existing lead:

- creates an `Activity` ("Repeat enquiry from website") with caller-supplied `message` text,
- writes a `ConsentRecord` against that lead,
- sets `priority: 'HIGH'`.

Repeatable at ten a minute per IP. The consequences are a polluted activity timeline, consent
records that did not come from the data subject, and the ability to force arbitrary leads to
HIGH priority — which distorts the follow-up queue reps work from.

The design intent is sound: a genuine repeat enquiry is real signal and should attach to the
existing lead rather than create a duplicate. The gap is that nothing distinguishes a genuine
repeat enquiry from a scripted one.

**Recommended:** cap the effect per lead per window — record at most one repeat-enquiry activity
per lead per 24 hours, and do not escalate priority from an unauthenticated call more than once.

**Scheduled alongside finding 1, after 27 September 2026** — same endpoint, same release.

## 3. Import staging retains rejected people indefinitely

**Severity: medium, and the most likely DPDP question.** `LeadImportRow.raw` stores the original
spreadsheet row verbatim:

> Exactly what was in the file, before mapping. The audit answer to "what did the spreadsheet
> actually say".

That is a good reason to keep it. The problem is *which* rows and *for how long*. Rows marked
INVALID or DUPLICATE never become leads — those people have no relationship with SIHL — yet
their names, mobiles, emails and any other columns the file happened to carry are retained
indefinitely alongside the rows that were accepted. A 5,000-row purchased list of which 1,000
are imported leaves 4,000 non-customers in the database permanently.

There is no purge for these rows anywhere in the codebase.

Access is bounded correctly (`mustFindBatch` gives an importer their own batches and unscoped
users all of them), so the exposure is retention, not authorisation. Holders of `lead:import`
with scope ALL — Marketing, Operations, Super Admin — can read every historical batch.

**Credit where due:** the model already captures `sourceOrigin`, `suppliedBy`,
`sourceDescription` and `lawfulBasisConfirmedAt` before any row is committed. That is more
provenance than most CRMs collect and it is exactly what a regulator asks for. Only retention
is missing.

**Recommended:** purge `LeadImportRow.raw` for INVALID and DUPLICATE rows after the batch is
committed plus a short review window (30 days is defensible), keeping the row's status, errors
and match reasoning so the import remains explainable. Retain raw rows for IMPORTED rows as long
as the lead they created.

## 4. The only retention routine in the codebase is never called

**Severity: medium.** `NotificationsService.purgeOld()` exists and is documented as the
retention purge — its own comment notes "these rows name clients, so they fall under the same
retention question". It has **zero callers**. There is no scheduler at all: no `@Cron`, no
`ScheduleModule` registration anywhere in the API.

So the one mechanism that looks like a retention control does not run, and nothing else ages
out — notifications, import rows, audit entries, soft-deleted records all accumulate. A control
that exists in code but never executes is worse than no control, because it reads as done.

**Recommended:** either wire a scheduler and give each personal-data table a documented
retention period, or delete `purgeOld()` so it stops implying a control that is not there. The
first is the real answer; the second is better than the status quo.

## 5. Marketing can export the entire book unmasked

**Severity: a decision for you, not a defect.** Downloaded the report workbook as six roles and
inspected every cell. Measured, not inferred:

| Role | Scope | `lead:export` | Leads sheet | Unmasked mobiles |
|---|---|---|---|---|
| SUPER_ADMIN | ALL | yes | 46 rows | 45 |
| MANAGEMENT | ALL | yes | 46 rows | 45 |
| **MARKETING** | **ALL** | **yes** | **46 rows** | **45** |
| SALES_MANAGER | TEAM | yes | 10 rows | 9 |
| OPERATIONS | ALL | no | *absent* | 0 |
| SALES_EXECUTIVE | SELF | no | *absent* | 0 |

The mechanism works exactly as designed: without `lead:export` the Leads sheet is omitted
entirely, and with it the sheet is still filtered by data scope — the sales manager gets their
ten, not everyone's forty-six. The export carries no PAN.

The observation is about who holds the combination. Marketing sits at scope ALL *and* holds
`lead:export`, so a marketing user can download the complete client book with unmasked mobile
numbers and email addresses. That may be exactly right — campaign lists need contactable
records. It is worth being a decision rather than an inheritance.

**Options, if you want it narrower:** cap Marketing at a scope below ALL; or split
`lead:export` into aggregate and row-level permissions; or leave as is and rely on the existing
detective controls (every export is audited with row count and scope, and exports by people
serving notice raise an alert).

## 6. Documents answer 403 where leads answer 404

**Severity: low.** Requesting a document outside your scope returns 403 "Record not
accessible", while the equivalent lead request returns 404. The 404 is a deliberate choice,
documented in the leads e2e suite: 403 confirms the record exists, and "does this person bank
with you" is answered by the difference between the two responses. The document path gives that
answer away.

**Recommended:** return 404 for documents outside scope, matching the leads convention.

---

## Controls checked and found sound

Recorded because an auditor will ask, and the evidence is cheaper to capture now.

- **Export gating and scoping.** Row-level lead data is gated on `lead:export`, filtered by the
  caller's data scope, capped at 20,000 rows, and audited with an `EXPORT` action carrying the
  row count, period and scope. Exports by staff in a notice period raise a separate alert —
  a detective control aimed at the most common data-loss event in broking.
- **Masking in list views.** `maskMobile` / `maskPan` / `maskEmail` are applied consistently
  across leads, customers, duplicates, partners, tasks and the messaging log. A list view is the
  easiest place for a bulk leak — one screenshot of twenty rows — and it is handled.
- **Audit redaction.** PAN, date of birth, passwords, password hashes, refresh and access
  tokens, MFA secrets and check-in photo keys never reach the audit table; mobile and email are
  masked but retained so "which mobile changed" is still answerable. The audit trail is read by
  more people than the source tables, and this accounts for that.
- **Document authorisation.** Every document path — upload, list, download grant, inline
  content — checks the *parent record's* scope rather than the document's, which is what stops
  someone reading another RM's client paperwork by guessing an id. Unknown entity types
  fail closed.
- **Public capture context.** `GET /events/capture-context/:kind/:code` returns only the partner
  or event name, venue and dates. No personal data, and rate limited at 30/minute.
- **No PAN in the export.** The workbook carries mobile and email but not PAN, which is the
  single most sensitive identifier in the dataset.

---

## Third-party processors

For the sub-processor list the compliance officer will need. Each of these receives personal
data and is therefore in scope for DPDP and for the hosting question.

| Processor | What reaches them | Notes |
|---|---|---|
| Railway | Everything — the database and application | Hosting region needs confirming; Indian clients' PII on non-Indian infrastructure is a question for compliance, not a code fix |
| SendGrid | Staff name, email address, and the temporary password in the reset email | The temporary password in the body is your explicit design decision; the mitigation is forced change at first sign-in |
| Sarvam | Raw audio of dictated notes | A rep dictating a visit note may say the client's name, number or financial position. Confirm whether dictation is enabled in production |
| Mappls | Rep latitude/longitude at visit check-in | Employee location, not client. Explicit check-in only, consistent with ADR-0007 — no continuous tracking |
| Messaging provider | Client mobile or email as the destination | The log itself stores the destination masked |

---

## Recommended order

1. **Finding 1** — the only issue reachable by someone with no credentials. Small change,
   no user-visible effect.
2. **Finding 2** — same endpoint, same release.
3. **Findings 3 and 4** together — retention is one piece of work, and it is the question a
   DPDP review will open with.
4. **Finding 5** — a decision, not a change. Needs you, not code.
5. **Finding 6** — tidy-up, any release.

Findings 1 and 2 touch the public capture path, which is in use for the 26–27 September event.
Neither change alters what a prospect sees, but both should be tested against a live QR scan
before that date rather than after.
