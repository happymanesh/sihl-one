# Module: Partners, campaigns and the audit trail

The three destinations that shipped as disabled "Soon" chips in Phases 1–3. They have little
in common as features; what they share is that each closes a loop the product had already
opened and left dangling — sourced business with no directory, attribution captured but never
reported, and an audit trail written but never readable.

---

## 1. User stories

| #    | Story                                                                            | Acceptance                                                              |
| ---- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| PR-1 | As operations I want to see every associate partner and what they have produced.   | `/partners`, searchable and filterable by status and type.              |
| PR-2 | As a manager I want one partner's whole picture without asking the partner.        | `/partners/[id]` — the same 360 endpoint the partner's own portal calls. |
| PR-3 | As compliance I must not see a partner's full mobile in a directory.               | Masked everywhere; the raw number is never serialised.                   |
| PR-4 | As finance I must not be shown a commission figure that reads as payable.          | Every earnings figure carries the estimate basis (ADR-0002).            |
| CM-1 | As marketing I want a campaign to be a named unit of spend.                        | Name, code, channels, objective, budget, dates, owner.                  |
| CM-2 | As marketing I want the tracking link generated, not typed.                        | `trackingUrl` with `utm_campaign` already attached.                     |
| CM-3 | As marketing I want leads from that link counted against the campaign.             | `utm_campaign` resolves to the campaign, case-insensitively.            |
| CM-4 | As a marketing head I want cost per lead and per account.                          | Both, or `null` — never a fabricated zero.                              |
| CM-5 | As finance I must not see marketing spend compared against brokerage we don't know.| Labelled "business won", never "return on spend".                       |
| CM-6 | As finance I do not want a reported campaign quietly reopened.                     | `COMPLETED → RUNNING` is refused.                                       |
| AU-1 | As compliance I want to search everything that happened.                           | `/admin/audit` with action, resource, date range and free text.         |
| AU-2 | As security I want the risky entries in one click.                                 | "Security only": failed sign-ins, denials, exports, deletes.            |
| AU-3 | As an investigator I want the field-level diff, IP and trace id.                   | Expandable per row; collapsed by default.                               |
| AU-4 | As an auditor I need to know the trail cannot have been edited.                    | No write path exists; the screen says so.                               |
| AU-5 | As an administrator I want to know who went looking through the trail.             | Reading the trail is itself audited, with the filters used.             |

---

## 2. Screens

| Screen           | Route              | Permission        |
| ---------------- | ------------------ | ----------------- |
| Partners         | `/partners`        | `partner:read`    |
| Partner 360      | `/partners/[id]`   | `partner:read`    |
| Campaigns        | `/campaigns`       | `campaign:read`   |
| Campaign detail  | `/campaigns/[id]`  | `campaign:read`   |
| New campaign     | `/campaigns/new`   | `campaign:create` |
| Audit trail      | `/admin/audit`     | `audit:read`      |

Every one is guarded twice — in the nav and in the page. A permission check that exists only
in the menu is one somebody can navigate around, and a bare 403 renders as the generic error
card rather than as an honest redirect.

Deliberate UI decisions:

- **Conversion rates are parenthesised** — `1 (11.1%)`. Unbracketed, "1" beside "11.1%" reads
  as "111.1%" at a glance and as exactly that to a screen reader.
- **Archived campaigns leave the default list.** They stay queryable by asking for them, but a
  screen someone opens to see what is running should not be a graveyard.
- **The audit list is one sentence per row.** The diff, IP, user agent and trace id are real
  needs, but for the one row in a hundred being investigated; inline they turn a scannable
  list into a wall.
- **A denial names the permission, not the controller.** "Denied access to a
  CampaignsController" tells a compliance reader nothing; "denied campaign:read" tells them
  precisely which grant to add.

---

## 3. Attribution — the loop that was open

Phase 1 captured `utm_campaign` on every lead and stored it as a string. Nothing resolved it.
Every campaign report would have read zero while the leads sat in the database with the right
code on them, and the failure would have looked like "the campaign did not work".

`LeadsService.resolveCampaignId()` now runs on both creation paths — the authenticated create
and the public capture endpoint — and matches the code case-insensitively, because it travels
through published links, email clients and eventually someone retyping it. A code that matches
nothing is left alone rather than rejected: the lead is real and arrived, and losing it because
marketing mistyped a link is a far worse failure than an unattributed lead.

Verified end to end in `marketing.e2e-test.ts`: a campaign created with code `attrib-…`, a lead
captured with `utm_campaign: ATTRIB-…` in a different case, and the campaign then reporting one
attributed lead.

---

## 4. Campaign metrics, and the number that was wrong

The first implementation published `returnOnSpend`. On real seeded data it read **75×**.

That figure is meaningless. A lead's `estimatedValue` is the size of the business the client is
expected to bring — portfolio value or turnover — not brokerage earned on it. Dividing it by
marketing spend produces an impressive multiple that is not a return, and a marketing budget
renewed on the strength of one is a decision made on a number nobody checked. SIHL ONE does not
know brokerage; the back office does (ADR-0002).

What is published instead:

| Metric                    | Meaning                                       | When it is null                  |
| ------------------------- | --------------------------------------------- | -------------------------------- |
| `costPerLead`             | Spend ÷ attributed leads                       | No spend recorded                |
| `costPerAcquisition`      | Spend ÷ conversions                            | No spend, or nothing converted   |
| `attributedValue`         | Business value of the clients won              | Never — zero is honest here      |
| `attributedValuePerRupee` | Business won per rupee spent, as a scale ratio | No spend recorded                |
| `budgetUsedPercent`       | Spend ÷ budget                                 | No budget                        |

Two rules run through it:

- **Null, never zero, when spend is unknown.** Zero is a claim — "this campaign was free" —
  and a dashboard that makes it will get a campaign renewed on it.
- **The verdict describes, it does not recommend.** "Worth continuing" needs a cost-per-
  acquisition benchmark SIHL has not set, and inventing a threshold puts a machine's opinion
  where the marketing head's judgement belongs. The sentence states the numbers:
  *"9 leads at ₹4,578 each; 1 converted at ₹41,200 per account."*

---

## 5. The audit trail

Written since Phase 1 by `AuditService`; read for the first time here by `AuditReadService`.
They are separate classes deliberately — nothing in the request path should be able to
accidentally acquire the ability to query the trail, and the writer's surface stays `record()`.

**Append-only** is a property of the deployment, not a convention: there is no create, update or
delete route, and the runtime database role is granted INSERT and SELECT on the table. The e2e
suite asserts all four verbs 404.

**Nothing is un-masked at read time.** `sanitiseForAudit` already redacted PAN, password hashes
and tokens and masked mobiles and emails on the way in. The trail is read by more people than
the source tables are, which is why it was narrowed on write — re-widening on read would defeat
the point.

**Reading is audited**, recording the filters used and the number of rows matched rather than
the rows themselves. Small entry, and it still answers "who went looking, for what".

Two write-side corrections this module forced:

- Sign-in was attributed to "The system", because the audit row is written *while*
  authenticating and there is no principal on the request yet. `AuditEntry.actor` now lets a
  caller name the actor explicitly.
- Denials recorded the controller class name as the resource and the handler name as the
  resource id. Neither is a resource or a record. They now record `permission` and the missing
  permission string.

---

## 6. Known limitations

- **No sending.** There is no email, SMS or WhatsApp delivery behind a campaign, and no audience
  builder or journey automation. A campaign is a unit of spend with attribution attached.
  Reporting before sending is the deliberate order: a builder that cannot report on itself
  spends money it cannot account for.
- **No partner create or edit screen.** The API has `createPartnerSchema` and
  `updatePartnerSchema`; only the read path has UI. Partners are onboarded by operations today.
- **Campaign spend is entered by hand.** No ad-platform integration.
- **The audit trail has no export.** Deliberate for now — an export of the audit trail is
  itself a data-egress event and wants its own approval flow, not a button.
- **No retention policy.** `audit_log` grows without bound. It needs a partitioning and
  archival strategy before volume matters.

---

## 7. Tests

| Suite                                | Covers                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| `contracts/test/campaign.test.ts`    | Code validation, transitions, null-not-zero, no ROI claim, URLs      |
| `contracts/test/audit.test.ts`       | Query coercion, summaries, articles, denial wording, security flag   |
| `api/test/e2e/marketing.e2e-test.ts` | Permission gates, mask, duplicate-code message, **attribution**, no audit write path |

The decisive test is `attributes a captured lead to its campaign, case-insensitively`. It is
the one that was failing silently before the module existed, and the one that makes every other
number on the campaign screen mean anything.
