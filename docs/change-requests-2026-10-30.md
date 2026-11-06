# SIHL ONE — Change Requests

**Raised by:** Business team, via Manesh Mukherjee
**Reviewed:** 28–30 October 2026
**Status:** Everything approved is built, merged to `main` and **live in
production since 4 November 2026** — the API at 09:21 and the web at 09:27
UTC, with no pending migrations in the batch.

Still open: **CR-20** needs a retention period from compliance. **CR-9** is
held for the next sprint and **CR-28** is parked. Everything else is built;
work done after 4 November 09:27 UTC is on `main` but not yet deployed.

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

---

**Delivered 1–4 November, and live in production:**

- all three application-level duplicate checks — `checkMobile`, Insta Lead and
  duplicate detection now key on mobile *and* account type
- lead detail panel, as a badge beside the name with status and priority
- lead list, where it replaced the Score column
- both CSV exports, as column 4 of 21
- every duplicate notice names the account type of the lead it *found*

**Not delivered, and split out:**

- **the lead import column** — still outstanding. See CR-29; it is a
  correctness gap rather than a display one and did not belong with the rest.
- **Report, MIS Summary and the performance report** — parked as CR-28. The
  wording above says "add the column", which was wrong and is the reason it
  looked small: MIS Summary is one row per *employee* and the sales report is
  aggregates, so neither has a lead row to put a column on.

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

### CR-31 — Next lead, without going back to the list
**Change.** A **Next lead** button at the foot of the header on a lead,
right-aligned, with the lead's position in the list beside it ("4 of 166").
It opens the lead that follows this one *in the list it was opened from*,
including across a page boundary, and **the filters count**: a list narrowed
to high-priority converted leads walks those five and nothing else.

**Why it is resolved against the list and not the lead.** "Next" has no
meaning on a lead by itself — the same lead has a different neighbour under a
different filter or a different sort. So each row on the leads list carries
the query it belongs to, and the lead re-runs that query to find its own
position. Re-running it, rather than carrying a snapshot of row ids, is also
what makes a filter the reader set *after* opening the list count.

**One filter list, read by both screens.** The list page and the lead page now
build the query from the same allowlist. Spelling it out twice is how a filter
gets added to one and forgotten in the other, and the failure is silent: the
reader walks Next through leads that were never on their screen. That value
also arrives off the address bar and is concatenated onto an API path, so
rebuilding it through the allowlist is what keeps a crafted one from
addressing a different endpoint.

**Where it does not appear.** A lead opened from Tasks, Pipeline, Visits,
Duplicates, search or a pasted link has no list to walk, so there is no
button. Nor is there one if the lead has left the list since it was opened —
somebody changed a status while it was on screen. A Next that quietly skipped
to the wrong record would be worse than none.

At the end of the list the button is replaced by "Last in this list" rather
than disappearing, so the reader knows they have finished rather than
wondering whether it broke. The breadcrumb now also returns to the list *as
filtered*, which it did not before.

**Not included:** a Previous button. Browser back already steps back through
the leads walked, and the ask was for Next. Say if it is wanted.

**Decision:** requested and built 6 November.

*Files:* `apps/web/src/lib/lead-list.ts`,
`apps/web/src/components/leads/{LeadCursorNav,LeadTable}.tsx`,
`apps/web/src/app/(app)/leads/page.tsx`,
`apps/web/src/app/(app)/leads/[id]/page.tsx`

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

## MIS

### CR-30 — An MIS section for the CEO
**Change.** A fifth navigation section, `MIS`, holding two reports for
SIHL-0044 (Tanmay Shah): **Team performance**, a per-person tree with counts
and idleness, and **CEO overview**, the same picture as charts.

**Team performance.** One row per vertical head — the CEO's direct reports —
expandable to their reports and so on down the line. A manager's row carries
the rollup of everyone beneath them; expanding adds their own book as a child
row, so children always sum to the parent. Columns: Vertical / Person, Team,
Idle, Untouched, In progress, Converted, Lost, Total leads, Last activity,
Idle days. Totals at the foot, and a unique-lead reconciliation beneath the
table. CSV exports fully expanded with Level and Reports-to columns.

Two exception rows, shown only when they are not zero, because both mean
something is wrong rather than something is happening:

- **SIHL-0044's own book.** He should own no leads. If he does, he appears
  with his own count alone and no expansion — rolling up his team would be the
  whole firm.
- **Unassigned.** Leads with no owner at all, which are otherwise invisible
  and are the ones most at risk.

**CEO overview.** Four headline numbers, week-on-week and month-on-month
progress, a vertical comparison and the pipeline composition.

**The colour decision is forced, and worth writing down.** The brand has three
usable hues and they are adjacent — navy, teal, brand-green, blue through to
green. Every three-colour set fails the normal-vision separation floor
(ΔE 9.5–13.7 against a floor of 15), meaning a reader with full colour vision
cannot reliably tell two verticals apart. So **colour never carries vertical
identity**: a vertical is named on the axis or in the row, comparison bars use
one hue, the ordered pipeline stages use one hue light-to-dark, and the only
two-series charts are created-versus-converted on the validated navy/teal
pair the app already ships. If verticals ever need to be lines over time, the
answer is small multiples, not five colours.

**Defaults taken where no answer was given.** Each is a constant, easy to
change once somebody decides:

- **Idle = 7 calendar days** with no activity.
- **Activity** means any of: logged an interaction, checked into a visit,
  created or updated a lead, or converted one.
- **A vertical head is a direct report of SIHL-0044** — structural, and it
  maintains itself as people join and leave. Note that `verticalHeadOf` uses a
  different rule (designation `NATIONAL_HEAD`, excluding SIHL-0044), so the
  Performance report may group people differently if the data disagrees.
- Weeks are **calendar weeks, Monday to Sunday**, so two printouts of the same
  week always match.

**Decision:** approved 6 November. Team performance first — it names people
and surfaces idle reps — then the overview.

**Access:** Super Admin and the CEO. With Performance withdrawn by CR-27 this
is the only per-person view in the product, which is a deliberate position
rather than an accident.

*Files:* `packages/contracts/src/mis.ts`,
`apps/api/src/modules/mis/`, `apps/web/src/app/(app)/mis/`,
`apps/web/src/components/shell/navigation.ts`

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

### CR-27 — Performance: Super Admin only, until it is mature
**Change.** Hide Performance from everybody except Super Admin, and keep it
that way until targets and incentives exist. The screen judges people against
numbers the system does not yet hold, so a mature version is a later
conversation; until then it should not be in anyone else's menu.

**This reverses CR-12's disposal.** CR-12 proposed restricting Performance and
was dropped, because CR-15 scoped reps to their own row and that was judged
enough. The reasoning has changed: the objection now is not who can see whose
figures, it is that the screen is not finished. CR-15 stays as it is — correct
regardless, and it is what makes the screen safe to reopen later.

**Today it is visible to very nearly everyone.** The menu entry is gated on
`analytics:sales:read`, held by MANAGEMENT, OPERATIONS, MARKETING,
SALES_MANAGER and SALES_EXECUTIVE.

**Two things make this more than a one-line change:**

- `analytics:sales:read` is shared with **Reports and the Dashboard**.
  Tightening it would take those away from the same five roles, which is not
  what is being asked. Performance needs a permission of its own —
  `performance:read` — granted to SUPER_ADMIN alone.
- The page has **no guard beyond the menu**. Anyone who knows the URL can open
  `/performance` today whether or not the item is shown, so removing the menu
  entry alone is presentation, not access control. The new permission has to
  be enforced on the route as well.

**Decision:** approved in principle — Super Admin only, as a holding position,
to be revisited once targets and incentives land.

*Files:* `packages/contracts/src/rbac.ts`,
`apps/web/src/components/shell/navigation.ts`,
`apps/web/src/app/(app)/performance/page.tsx` and its `verticals` sub-page,
plus the API controller guarding the performance endpoints.

**Note:** CR-25 lists "add account type as a dimension" to the performance
report. If this is approved first, that work only ever reaches Super Admin —
worth deciding whether it is still wanted now or deferred with the rest.

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

**Parked for the next sprint**, by decision on 4 November. Blocked since 30
October on the same thing either way: somebody has to supply the brochures,
by sending the files or by allowing the fetch from the host. Nothing else
about it is undecided.

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

### CR-28 — Account type as a reporting dimension
**Parked for a future change,** split out of CR-25 once the rest of it
shipped.

**Change.** Account type does not appear in the sales Report, the MIS Summary
or the performance report.

**Why it is not a column.** CR-25 described this as "add the column, and a
filter", which understated it and is why it read as small. Neither report has
a lead-level row:

- **MIS Summary** is one row per *employee* — counts of leads per rep. Account
  type means either a set of extra columns per type, or a filter over the
  whole sheet.
- **Sales report** is aggregates — by owner, product, source, status and
  branch. Account type means a new breakdown (`byEntityType`), not a column.

So this is a decision about which question the report should answer, and worth
designing rather than ticking off.

**The performance part is very likely moot.** CR-27 restricted Performance to
Super Admin, so a dimension added there would be seen by one person. It should
move with the rest of the deferred Performance work, not with this.

**What would make it worth doing:** volume. `entityType` only became settable
at the end of October, so almost every lead in production is Individual and a
breakdown today would be one bucket at nearly 100%. The Leads list now shows
account type, so the count is visible at a glance. When somebody asks "how
many HUF accounts did we open this quarter?" and the answer matters, this
earns its place.

*Files (if revived):* `apps/api/src/modules/reports/{reports,mis}.service.ts`,
`apps/api/src/modules/performance/performance-report.service.ts`,
`packages/contracts/src/{report,performance}.ts`

---

### CR-29 — Lead import cannot set account type
**Outstanding — not parked.** Raised here because it was logged inside CR-25
and would otherwise have been closed with it.

**Change.** `IMPORTABLE_FIELDS` has no `entityType`, so every row of every
imported file becomes an Individual whatever the spreadsheet says. A file of
HUF accounts — the case where a bulk file is most likely to carry them — is
silently recorded as a set of individuals.

**This is a correctness gap, not a display one,** and that is why it does not
belong with CR-28. The consequences compound:

- the leads are wrong from the moment they land, and nothing on screen says so
- the duplicate key is `(mobile, entityType)`, so an HUF imported as an
  Individual will later collide with the karta's own lead — and the rep who
  hits that refusal has no way to tell why
- it is the one remaining path that can still write the wrong account type

Reps adding leads by hand already pick the type on the form, and both exports
now carry it, so the import is the last gap in a rule that is otherwise
applied everywhere.

**Decision:** build it now, taken 4 November — and built the same day.

**Delivered.** `account_type` is an importable column, auto-mapped from the
spellings these files use. An unrecognised value fails its row rather than
being dropped, because this field decides what the record *is*; blank still
means INDIVIDUAL, so files that imported yesterday import identically.

Building it found a fourth place the old rule had survived. CR-25 fixed
`checkMobile`, Insta Lead and the duplicates screen; the importer has its own
matching, and it keyed on the number alone — so a file holding a karta and
the family's HUF silently dropped the second row as a duplicate of the first.
The within-file key and the event matcher now read the number *and* the
account type. The fuzzy matcher is untouched: it weighs name, email, PAN and
city, and its verdict is a suggestion the importer overrides at commit.

*Files:* `packages/contracts/src/import.ts` (`IMPORTABLE_FIELDS`, the alias
map), `apps/api/src/modules/imports/imports.service.ts`

---

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
| CR-12 | Restrict Performance to Super Admin / Management / Operations | Discarded. CR-15 addresses the underlying concern by scoping reps to themselves, without removing access. **Superseded by CR-27**, which restricts the screen for a different reason — it is unfinished, not unsafe. |

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

- **CR-20** — retention period, from compliance. The only one still waiting
  on somebody outside the team.

CR-9 moved to the next sprint and CR-29 was built, both on 4 November.
