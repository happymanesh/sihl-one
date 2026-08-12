# Module: CRM & Lead Management

The core of Phase 1. Covers lead capture through to conversion, and the interaction record
that makes the rest of the platform possible.

---

## 1. User stories

### Customer / prospect

| #    | Story                                                                                                       | Acceptance                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| C-1  | As a visitor I want to request a call back with minimal typing, so I can enquire in under a minute.           | Name, mobile and consent are the only required fields. Confirmation shows a reference. |
| C-2  | As a visitor I want to know my enquiry was received.                                                          | A `LD-YYYY-NNNNNN` reference is displayed immediately.                          |
| C-3  | As a person under DPDP I want my consent recorded, not assumed.                                               | Consent checkbox is unticked by default; the exact wording shown is stored with timestamp and IP. |

### Sales executive

| #    | Story                                                                                                        | Acceptance                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| SE-1 | As an RM I want to see only my own leads, so my list is my work.                                              | List and detail are filtered to `ownerId = me`. Others return 404.            |
| SE-2 | As an RM I want to know which lead to call next.                                                              | Pipeline sorts by score; overdue follow-ups surface on the dashboard.          |
| SE-3 | As an RM I want to know *why* a lead is hot, so I can trust the score.                                        | Detail shows every scoring factor with its point contribution.                |
| SE-4 | As an RM I want to log a call and set the next follow-up in one step.                                         | The interaction form includes a next-follow-up field.                          |
| SE-5 | As an RM I want the full phone number on the lead I am about to call.                                         | Detail returns unmasked contact details; the read is audited.                  |
| SE-6 | As an RM I want to convert a qualified lead without re-keying anything.                                       | Convert carries name, mobile, city and product interest to the customer.       |

### Sales manager

| #    | Story                                                                                                        | Acceptance                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| SM-1 | As a manager I want to see my whole team's pipeline.                                                          | TEAM scope returns own + direct reports' leads.                               |
| SM-2 | As a manager I want unassigned leads in my branch to be visible, so none go stale.                            | TEAM scope includes unowned leads within the manager's org subtree.           |
| SM-3 | As a manager I want to reassign leads, including in bulk.                                                     | Assign and bulk-assign, limited to my own team.                                |
| SM-4 | As a manager I want to know why we lose deals.                                                                | A lost reason is mandatory and stored for analysis.                            |

### Marketing

| #    | Story                                                                                                        | Acceptance                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| MK-1 | As a marketer I want every lead attributed to its campaign.                                                   | UTM parameters, referrer and landing path are captured at creation and never rewritten. |
| MK-2 | As a marketer I want to know which source converts, not just which source is loudest.                         | Source breakdown plus cohort conversion rate.                                  |

### Management

| #    | Story                                                                                                        | Acceptance                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| MG-1 | As management I want company-wide visibility without the ability to alter records.                            | ALL scope, read and export permissions only. Writes return 403.               |
| MG-2 | As management I want a conversion rate I can trust.                                                           | Cohort-based: conversions among leads *created* in the window, over leads created in that window. |

---

## 2. Screens

| Screen             | Route              | Notes                                                                                 |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| Landing + capture  | `/`                | Public. Attribution read client-side, posted as hidden fields.                        |
| Lead list          | `/leads`           | URL-backed filters, so a filtered view is shareable and bookmarkable. Table on desktop, cards below `md`. |
| Pipeline           | `/pipeline`        | Kanban over the four live stages only. Counts come from a grouped query, not the board. |
| Lead detail        | `/leads/[id]`      | Header, action tabs, timeline; sidebar with next best actions, score breakdown, details, attribution, stage history. |
| New lead           | `/leads/new`       | Three grouped fieldsets: who, where from, what they want.                              |
| Customer 360       | `/customers/[id]`  | Profile, onboarding stepper, holdings, engagement, acquisition, insights.              |

Deliberate UI decisions:

- **Contact details are masked in lists, full on detail.** A list view is the easiest place
  for a bulk PII leak — one screenshot of twenty phone numbers. Masking happens server-side,
  so the full value never reaches the browser on a list request.
- **The mobile layout is a genuine second layout, not overflow scroll.** Field sales live on
  phones; a horizontally-scrolling table is unusable on a visit.
- **The data scope is displayed in the sidebar.** It is the answer to "why can't I see that
  lead?", which is otherwise a support ticket.

---

## 3. Data model

`lead`, `lead_status_history`, `activity`, `task`, `consent_record`, plus `customer` on
conversion. Full definitions in `apps/api/prisma/schema.prisma`.

Constraints that carry business meaning:

| Constraint                        | Rule                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| `lead_active_mobile_key`          | One open lead per mobile (partial: excludes closed leads)    |
| `lead_active_pan_key`             | One open lead per PAN                                        |
| `lead_lost_requires_reason`       | `status = LOST` implies `lostReason IS NOT NULL`             |
| `lead_score_range`                | Score between 0 and 100                                      |
| `lead_estimated_value_non_negative` | Value is never negative                                    |

---

## 4. API

| Method | Path                    | Permission      | Notes                                        |
| ------ | ----------------------- | --------------- | -------------------------------------------- |
| POST   | `/leads/capture`        | *public*        | 10/min per IP. Consent mandatory.            |
| GET    | `/leads`                | `lead:read`     | Scoped, paginated, masked                    |
| GET    | `/leads/pipeline`       | `lead:read`     | Grouped counts and value                     |
| GET    | `/leads/:id`            | `lead:read`     | Unmasked; audited                            |
| POST   | `/leads`                | `lead:create`   | Duplicate-guarded                            |
| PATCH  | `/leads/:id`            | `lead:update`   | Rejects status changes                       |
| POST   | `/leads/:id/status`     | `lead:update`   | Transition-validated                         |
| POST   | `/leads/:id/assign`     | `lead:assign`   | Team-limited                                 |
| POST   | `/leads/bulk-assign`    | `lead:assign`   | Out-of-scope ids skipped, not rejected       |
| POST   | `/leads/:id/convert`    | `lead:convert`  | Requires PAN + email                         |
| DELETE | `/leads/:id`            | `lead:delete`   | Soft delete                                  |

All errors are RFC 9457 Problem Details with field-keyed `errors` for validation failures.

---

## 5. Validation rules

| Field            | Rule                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `mobile`         | Normalised (strips `+91`/`91`/`0`, spaces, dashes), then `^[6-9]\d{9}$`    |
| `email`          | Trimmed, lowercased, RFC-shaped                                           |
| `pan`            | Uppercased, `^[A-Z]{5}\d{4}[A-Z]$`                                        |
| `pincode`        | `^[1-9]\d{5}$`                                                            |
| `estimatedValue` | Non-negative, ≤ 1,000,000,000                                             |
| `productInterest`| At most 12 values from the enum                                           |
| `consentToContact` | Must be literally `true` on public capture                              |
| `occurredAt`     | An activity cannot be logged with a future timestamp                      |
| Password         | ≥ 12 chars, upper + lower + digit + special                               |

Normalisation happens once, at the API boundary, so the database holds one canonical form.

---

## 6. Business rules

1. **One open lead per person.** Enforced by partial unique index *and* checked in the service
   for a friendly message. Closed leads are excluded, so a returning prospect is a new lead.
2. **Re-enquiry attaches, never duplicates.** A repeat web form submission logs an activity on
   the existing lead and raises its priority. Genuine signal: filling the form twice means
   more interest, not less.
3. **Status transitions follow the table**, shared with the UI. `NEW → CONVERTED` is
   impossible; conversion goes through its own endpoint because it needs a PAN.
4. **`CONVERTED` is terminal and read-only.** Edit the customer instead.
5. **`LOST` requires a reason.**
6. **Stage duration is recorded on each transition**, so drop-off analysis is a simple query.
7. **A lead follows its owner's org unit on reassignment**, so branch reporting stays coherent.
8. **Creation defaults the owner to the creator** (for internal users) — an unassigned lead is
   a lead nobody is accountable for.
9. **Conversion carries consent forward**, writing new customer-scoped consent rows so the
   chain is provable.
10. **Scores are recomputed** on creation, on update, and whenever an interaction is logged.
11. **System-generated activities do not count toward engagement**, so a status change cannot
    inflate a score.
12. **Bulk operations silently skip out-of-scope ids** rather than erroring — an error message
    naming rejected ids would confirm which ids exist.

---

## 7. Test cases

### Automated (all passing)

| ID    | Case                                                            | Level    |
| ----- | --------------------------------------------------------------- | -------- |
| T-01  | Mobile normalisation accepts `+91 98765 43210`, rejects `5876…`  | contract |
| T-02  | PAN accepts `abcde1234f`, rejects `ABCD1234F`                    | contract |
| T-03  | `NEW → CONVERTED` rejected; `NEW → CONTACTED` allowed            | contract |
| T-04  | `CONVERTED` has no onward transitions                            | contract |
| T-05  | Scope never widens beyond the role ceiling                       | contract |
| T-06  | RBAC matrix references only real permissions                     | contract |
| T-07  | Score stays within 0–100 at both extremes                        | contract |
| T-08  | Referral scores above a cold import                              | contract |
| T-09  | Score decays as a lead goes quiet                                | contract |
| T-10  | Every awarded point is explained by a factor                     | contract |
| T-11  | Masking keeps only the last four digits                          | contract |
| T-12  | SELF scope filters to `ownerId`                                  | unit     |
| T-13  | Partner SELF scope filters to `partnerId`, not `ownerId`         | unit     |
| T-14  | TEAM scope includes unassigned leads in the subtree              | unit     |
| T-15  | Hierarchy scope with no org unit denies everything               | unit     |
| T-16  | Audit never stores a password, hash, PAN or date of birth        | unit     |
| T-17  | Audit masks but retains mobile and email changes                 | unit     |
| T-18  | Audit diff ignores `updatedAt`                                   | unit     |
| T-19  | Anonymous request returns 401                                    | e2e      |
| T-20  | Wrong password and unknown account return identical messages     | e2e      |
| T-21  | Visible counts narrow as scope narrows (65 → 62 → 15 → 9)        | e2e      |
| T-22  | Out-of-scope lead returns 404, not 403                           | e2e      |
| T-23  | **Out-of-scope *write* returns 404 and changes nothing**         | e2e      |
| T-24  | List responses mask contact details                              | e2e      |
| T-25  | Management cannot create a lead (403 naming `lead:create`)       | e2e      |
| T-26  | Executive cannot assign (403)                                    | e2e      |
| T-27  | New lead is scored on creation                                   | e2e      |
| T-28  | Duplicate open mobile rejected with a usable message             | e2e      |
| T-29  | Invalid transition rejected                                      | e2e      |
| T-30  | `LOST` without a reason rejected                                 | e2e      |
| T-31  | Happy path records every transition                              | e2e      |
| T-32  | Conversion creates a customer linked back to the lead            | e2e      |
| T-33  | Converted lead is read-only                                      | e2e      |
| T-34  | Public capture works unauthenticated and records consent         | e2e      |
| T-35  | Capture without consent rejected                                 | e2e      |
| T-36  | Invalid mobile returns field-keyed errors                        | e2e      |

**T-23 exists because of a real defect found during Phase 1**: reads were correctly locked
down while writes were completely open. See ADR-0003.

### Manual regression (not yet automated)

- Kanban column counts match the list view when a filter is applied.
- Dark theme has sufficient contrast on badges and score bars.
- Lead list is usable one-handed on a 375 px viewport.
- Debounced search does not fire per keystroke.

---

## 8. Seed data

Reference data (roles, org hierarchy) is idempotent and safe in every environment. Demo data
is blocked when `NODE_ENV=production`.

The demo book is shaped to look like SIHL's actual business — Gujarat-weighted, equity and
derivatives heavy, ~17% conversion — because a demo where half the leads convert teaches the
wrong thing. Nine users across five branches, one partner, three campaigns, 64 leads, 12
customers, 22 tasks. Scores are produced by the real scorer, not invented.

---

## 9. Production checklist for this module

See [../production-checklist.md](../production-checklist.md). Module-specific items:

- [ ] Lost-reason list confirmed with the sales leadership
- [ ] Scoring weights recalibrated after one quarter of real outcomes
- [ ] Duplicate-merge UI built (the `mergedIntoId` column exists; the flow does not)
- [ ] Lead import with de-duplication (`lead:import` permission exists; endpoint does not)
- [ ] Retention policy agreed for leads that never convert
