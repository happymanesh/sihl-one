# SIHL ONE — Change Requests

**Raised by:** Business team, via Manesh Mukherjee
**Reviewed:** 28–30 October 2026
**Status:** Approved items have been built and are on the branch
`prod-findings-nov-2026`. Nothing is deployed. CR-9, CR-20 and CR-26 are
still open — see Open questions.

Each point was checked against the source before being logged. Where the
business reported a fault, the finding states whether it is a defect, intended
behaviour, or something else entirely — three points changed shape once the
code was read, and two were dropped.

**18 to build · 1 parked · 2 dropped**

---

## Build first

These two are wrong in production now.

### CR-13 — Reports: date range read as UTC, not IST
**Defect.** `reportRangeSchema` uses `z.coerce.date()`, which parses
`2026-10-05` as UTC midnight. A 05–07 Oct range is queried as
**05-Oct 05:30 → 07-Oct 05:30 IST** — the 05:30 being exactly the IST offset.

Consequence: the final day is almost entirely excluded, and the first 5½ hours
of the first day are silently dropped.

**Fix:** parse `from` as IST 00:00:00 and `to` as IST 23:59:59.999 using the
existing `istDayWindow()` helper, already used correctly by the Daily Activity
report. Affects every section of Reports and the Excel export, which all call
`period(range)`.

**Note for the business:** every report circulated to date has understated its
last day.

*Files:* `packages/contracts/src/report.ts`,
`apps/api/src/modules/reports/reports.service.ts`

---

### CR-15 — Performance: reps can see colleagues
**Defect.** The population filter scopes by org unit, never by the person's
data scope:

```ts
const reach =
  user.dataScope === 'ALL' ? {}
  : user.orgUnitPath ? { orgUnit: { path: { startsWith: user.orgUnitPath } } }
  : { id: user.id };
```

A Sales Executive has `dataScope = SELF` but also has an org unit, so they
fall into the middle branch and see **every colleague in their branch**, names
and scores. The `{ id: user.id }` fallback only fires for someone with no org
unit — effectively nobody.

**Fix:** honour `dataScope`. SELF resolves to the person alone.

This became the only control on the problem once CR-12 was discarded.

*File:* `apps/api/src/modules/performance/performance-report.service.ts`

---

## Tasks

### CR-2 — Datagrid, paging, lead number, column search
**Change.** The list fetches `pageSize: 50` with no pagination control. The
API already supports `page`/`pageSize`, so this is UI-only.

- Paging at **25 per page**
- Show the **lead number**
- Render as a **datagrid**
- **Search on every column**

*File:* `apps/web/src/app/(app)/tasks/page.tsx`

---

### CR-3 — "Completed" filter returns nothing
**Defect.** Task status is master-driven: `task.status` holds a *code* from
`TaskStatusMaster`, which also carries a `category` of OPEN / IN_PROGRESS /
DONE / CANCELLED. The Completed tab links to `?status=DONE`, and the filter
does a literal match on the code:

```ts
if (query.status) and.push({ status: query.status });
```

So it only matches a status whose code is exactly `DONE`. The master is
administrator-editable, so any status coded `COMPLETED`, `CLOSED` or a
branch's own wording is invisible.

Four lines below, `overdueOnly` correctly filters on `statusMaster.category` —
the same file holding two different ideas of what status means.

**Fix:** filter on `statusMaster.category`. Also repairs Cancelled.

*File:* `apps/api/src/modules/tasks/tasks.service.ts`

---

### CR-4 — Tasks showing no lead
**Defect.** Eight were found in production and deleted manually. They were
almost certainly **not orphaned** — they were customer follow-ups the screen
cannot display.

The chain:

1. A visit can be planned against a **CUSTOMER**, not only a lead.
2. Completing that visit with a follow-up date copies the visit's entity
   through, creating a task with `entityType: 'CUSTOMER'`.
3. The Tasks list resolves leads only:
   `.filter((task) => task.entityType === 'LEAD' && task.entityId)`

So the task is correctly linked but renders blank.

Ruled out: leads are only ever soft-deleted, so `entityId` cannot dangle; the
lead lookup has no `deletedAt` filter, so even a deleted lead resolves; merge
re-points tasks; offboarding only changes `assigneeId`; and no task-creation
UI exists.

**This recurs** — every customer visit closed with a follow-up produces
another.

**Fix:** resolve customers as well as leads, and show the right entity name
and link.

*Files:* `apps/api/src/modules/tasks/tasks.service.ts`,
`apps/api/src/modules/visits/visits.service.ts`

---

## Leads

### CR-5 — Lead close writes a hardcoded status
**Defect.** `standDownOpenWork` correctly *reads* open status codes from the
master, then writes a literal:

```ts
data: { status: 'CANCELLED' }
```

If no master row is coded `CANCELLED`, that write is wrong. Same bug family as
CR-3 — fix both in one pass.

*File:* `apps/api/src/modules/leads/leads.service.ts`

---

### CR-6 — No way back from a lead
**Change.** The lead detail page has no back control; browser back is the only
exit. Leads are reached from Tasks, Pipeline, Visits, Duplicates and search, so
a hardcoded "← Tasks" would be wrong from most of them.

**Decision:** generic "← Back" using browser history — correct from every entry
point.

---

### CR-17 — HUF cannot share an individual's mobile
**Change.** `assertNoOpenDuplicate` refuses any new lead whose mobile matches
an open lead. The check looks at mobile alone, and **leads carry no entity
type at all** — so an HUF, legally a separate entity sharing the karta's
number, is treated as the same person. The only escape today is if the
individual lead is already closed, which it usually is not.

**Decision:** add an entity type to Lead (Individual / HUF / Corporate / NRI /
Trust) and key the duplicate check on **mobile + entity type**.

The same question will arise for Corporate and Partnership accounts sharing a
director's number.

*Files:* `apps/api/prisma/schema.prisma`,
`apps/api/src/modules/leads/leads.service.ts`, lead form, lead import

---

### CR-25 — Carry account type through the rest of the product
**Change.** CR-17 landed the column and the database key, and stopped there.
`lead.entityType` is `NOT NULL DEFAULT 'INDIVIDUAL'`, so every lead that
predates it already reads as Individual and anything that does not name a type
gets Individual; `lead_active_mobile_entity_key` already enforces one live
lead per `(mobile, entityType)`; Insta Lead's insert omits the field and so
saves an Individual. All of that is correct and needs no further work.

What was missed is that the identity rule is only half-applied. The database
knows the pair; three places in the application still key on the number alone,
and four screens never show the type at all.

**Bugs left behind by CR-17:**

- `checkMobile` — the Add Lead form's live duplicate warning — keys on mobile
  only, so the form warns "already exists" for an account type the database
  would happily accept. The screen and the constraint disagree.
- Insta Lead's duplicate pre-check keys on mobile only. A walk-in whose number
  sits on an **HUF** lead is attached to that HUF lead instead of starting an
  Individual one — the opposite of what Insta Lead is for.
- Duplicate detection groups `by: ['mobile']`, so a legitimate
  Individual + HUF pair is reported as a duplicate for ever, with nothing a
  user can do to resolve it.

**Missing display:**

- Lead **detail** panel — account type is not shown anywhere, so a rep cannot
  tell an HUF lead from the karta's own.
- **Lead import** — add an account-type column. Without it every imported row
  is silently an Individual, which is also the one case where a file of HUF
  accounts is most likely to arrive.
- **Report** and **MIS Summary** — add the column, and a filter.
- **Performance report** — add account type as a dimension.

**Decision:** approved. One live lead per number *per account type*, applied
consistently in the application and not only in the database; account type
visible wherever a lead is read, imported or counted. Leads with no type
continue to read as Individual, and Insta Lead continues to save Individual.

*Files:* `apps/api/src/modules/leads/leads.service.ts`,
`apps/api/src/modules/duplicates/duplicates.service.ts`,
`apps/api/src/modules/imports/imports.service.ts`,
`apps/api/src/modules/reports/{reports,mis}.service.ts`,
`apps/api/src/modules/performance/performance-report.service.ts`,
`packages/contracts/src/{import,report,performance}.ts`,
`apps/web/src/app/(app)/leads/[id]/page.tsx`

---

### CR-18 — Remove lead-level "Lost reason"
**Change.** Superseded by product-wise status. The lead-level reason still
displays on the detail panel, and `LeadActions` still *asks* "Why was it
lost?".

**Decision:** remove the display **and** the lead-level capture. Loss reasons
live per product only.

**Depends on:** ships with CR-19 — see below.

---

## Visits

### CR-7 — Default list, filters and search
**Change.** The page currently shows "Today's plan" with three non-clickable
tiles (Planned today / Completed today / In progress) and no search.

- Default list: **Planned + Overdue + In-progress**
- Tiles become **clickable filters** — clicking "Planned today" shows only
  those
- Add buttons: **Open items**, **Completed in last 7 days**, **Overdue**
- Add a **free-text search** across any detail in the row

---

### CR-8 — "Needs review" cannot be actioned
**Gap.** The flag is set automatically when a completed visit's GPS evidence
does not hold up: no location at check-in, a fix too imprecise to place the
visit, check-out beyond the drift threshold, or a visit under two minutes. It
is the compensating control for ADR-0007, which deliberately stopped poor
signal from blocking a check-in.

A filter exists, but there is **no action** — nothing marks a visit reviewed
and nothing records who looked, so flagged visits accumulate indefinitely.

**Decision:** simple acknowledgement — **reviewed by + date**.

---

### CR-10 — Numbering and open-lead button
**Change.** No row numbering, and no link to the related lead anywhere on the
page, though a visit always knows its entity.

---

## Performance

### CR-16 — Numbering and drilldown
**Change.** Tiles and numbers are static text. Add row numbering, and make
both tiles and numbers drill through to the underlying list, with a Go-Back
control.

---

### CR-19 — Rebalance the score
**Change.** Current: `overall = outcome × 0.55 + behaviour × 0.45`.

Three problems:

1. **Outcome compresses at the top.** `clamp(60 × outcomeIndex)` caps at index
   1.67, so 1.7× and 3× expectation score identically.
2. **The Lost-reasons metric breaks** once CR-18 removes lead-level reasons —
   it would read a field nobody populates, costing every rep 5%.
3. **Volume offsets neglect.** A rep with 13 leads and 7 never contacted
   scored 57, double a rep with 6 leads and none converted (28).

**Agreed replacement — outcome:**

```
index ≤ 1 :  55 × index                 (parity = 55)
index > 1 :  55 + 30 × (index − 1)      (caps at index 2.5)
```

**Agreed replacement — behaviour:**

| Metric | Now | New |
|---|---|---|
| First response | 0.30 | **0.25** |
| **Contact coverage** *(new)* | — | **0.25** |
| Follow-up coverage | 0.25 | **0.20** |
| Overdue | 0.25 | **0.15** |
| Engagement | 0.15 | **0.10** |
| Lost reasons *(repointed to product level)* | 0.05 | **0.05** |

Overall split stays 55 / 45.

Contact coverage means *ever reached CONTACTED or beyond*, taken from status
history — not current status, or a lead contacted then disqualified would
count against the rep.

**Before release:** scores change for everyone the day this ships. Run old
against new on real data and circulate the comparison first.

**Depends on:** must ship with CR-18.

---

## Navigation and access

### CR-11 — Products below My business
**Change.** Both sit in the Work section; a reorder. Note "My business" is
invisible to staff, so for most users Products simply moves to the end of
Work.

---

### CR-14 — "My business" is a dead menu item for admins
**Defect.** The menu entry is gated on the permission `analytics:partner:read`,
but the page requires the PARTNER **role** and redirects everyone else to the
Dashboard. Super Admin holds every permission, so they see an item that can
only bounce them — which is why it looked identical to the Dashboard.

**Decision:**
- **Partners** keep their own portal unchanged.
- **Super Admin** sees the menu item, picks a partner, and views that
  partner's portal.
- **All other staff** no longer see it.

---

### CR-21 — Messaging restricted to Super Admin
**Change.** Currently gated on `campaign:read` / `campaign:create`, which
Management and Marketing also hold.

Also: one route is guarded on **`activity:create`** — held by Sales Managers,
Sales Executives, Operations and Partners. Restricting the menu alone would
leave that side door open, so it is part of this change.

*File:* `apps/api/src/modules/messaging/messaging.controller.ts`

---

## Content

### CR-9 — Product pages from brochures
**Change.** Extract content from the brochure PDFs and populate each product's
detail page: `summary`, `description`, `keyBenefits`, `chargesSummary`,
`eligibility`, `riskNote`.

Source: the brochures directory on the application host.

**Open:** the PDFs have to be supplied — either by allowing the fetch from the
host, or by sending the files.

---

## Design decisions

### CR-26 — Should Tasks and Visits be one thing?
**Asked.** Whether the two modules should stay separate or be combined, and
what actually distinguishes them.

**Answer: keep the two records separate. The duplication is in the screens,
not in the model.**

A task is an intention. A visit is evidence that something happened in the
physical world. Every other difference follows from that one:

| | Task | Visit |
|---|---|---|
| Lifecycle | Open → Done, a switch | Planned → Checked in → Checked out, a sequence with a duration |
| Carries | title, due date, assignee, priority | location, check-in/out times, photo, geo-coordinates, attendees |
| Who | one assignee | an owner *plus* colleagues who came along, credited separately |
| Oversight | none | needs-review, with a manager's acknowledgement (CR-8) |

The sharpest evidence turned up while fixing the task overdue defect: **the
two modules define "overdue" differently, and both are right.** A task is
overdue when its due *day* has passed — "call them by Friday" is not late at
ten on Friday morning. A visit is overdue when its appointment *time* has
passed — a two o'clock meeting is late at three. Merging the records forces
one rule onto both, and it would be wrong for half of them.

Merging would also force a choice between dragging check-in, geolocation,
photo, attendees and the review flow onto every task — most of which are phone
calls — or dropping them from visits. Those fields exist because a field visit
is a *claim about where somebody was*; they are the audit trail, and ADR-0007
deliberately shapes them as explicit check-in/check-out rather than tracking.
Neither outcome is acceptable.

**What is genuinely duplicated** is the surface. A rep asking "what am I doing
today?" looks in two menu items, reads two sets of tiles, learns two filter
idioms and reconciles two meanings of overdue. That is the complaint behind the
question, and it is fixable without touching either model.

**Proposal:** one read-only agenda view — "My day" — merging today's tasks and
today's visits into a single ordered list, each row labelled with its type and
opening its own record. Both modules stay exactly as they are; nothing is
migrated, and no field moves.

**Smaller first step, if the appetite is uncertain:** surface the next visit on
the Tasks screen, or a combined count on the dashboard, and see whether reps
stop asking. Cheap to build, cheap to withdraw.

**Decision needed:** full "My day" view, the smaller step, or neither. Nothing
has been built.

*Files (if approved):* a new read-only route under `apps/web/src/app/(app)/`,
reading the existing task and visit list endpoints. No schema change.

---

## Parked

### CR-20 — Audit trail retention
**Next sprint.** `audit_log` has no retention or archival and grows unbounded.

**Retention of 7 or 15 days was proposed and is not recommended.** SIHL is a
SEBI-registered intermediary; records must be preserved for a minimum of five
years, longer where a proceeding is pending. An audit trail of who changed
what on client records is exactly what an inspection asks for, and deleting it
at 15 days would also remove the firm's own ability to answer "who reassigned
this lead". **The period must be confirmed by the compliance officer.**

Proposed shape — tier rather than delete:

| Tier | Age | Where |
|---|---|---|
| Hot | 0–90 days | `audit_log`, indexed, queryable in the UI |
| Warm | 90 days – 2 years | Monthly partitions or a compressed archive |
| Cold | 2–8 years | Object storage, restorable on demand |

Three cheap wins first: partition by month so pruning is a partition drop; cap
the `changes` JSON payload, which is most of the volume; and measure which
`resource` dominates, in case the growth is a defect rather than real volume.

---

## Dropped

| # | Item | Reason |
|---|---|---|
| CR-1 | Event captures: assign unassigned leads to the event owner | Cancelled by the business. This was removed deliberately — it made every walk-up the property of one person who never asked for it, and meant a stall's registrations could not be handed out because they were already owned. |
| CR-12 | Restrict Performance to Super Admin / Management / Operations | Discarded. CR-15 addresses the underlying concern by scoping reps to themselves, without removing access. |

---

## Sequencing notes

- **CR-13 and CR-15 first** — both are wrong in production today.
- **CR-18 and CR-19 together** — separating them breaks the Lost-reasons
  metric.
- **CR-3 and CR-5 in one pass** — the same defect pattern, writing or matching
  a literal status instead of resolving it from the status master.
- **CR-6, CR-10 and CR-16** all add navigation back and forth between screens;
  worth doing as one piece of work so the behaviour is consistent.
- **CR-25 after CR-17** — it finishes CR-17. Do the three application-level
  duplicate checks before the display work: while the form, Insta Lead and
  duplicate detection still read the number alone, the screens contradict the
  constraint, and showing the type everywhere would only make the
  contradiction easier to see.

## Open questions

- **CR-9** — how the brochure PDFs will be supplied.
- **CR-20** — retention period, from compliance.
- **CR-26** — whether to build the "My day" agenda view, the smaller first
  step, or neither. The question of merging Tasks and Visits is answered —
  keep them separate — and only the surface change is undecided.
