# Module: Duplicate review and merge

The same person, more than one record, usually more than one owner. The importer already
refuses to create a row that definitely matches an existing lead; this covers what it cannot —
the person who enquired on the website in March, walked into a branch in June, and was entered
again by a different executive.

---

## 1. User stories

| #    | Story                                                                       | Acceptance                                                            |
| ---- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| DM-1 | As a manager I want to see where the same person exists twice.                | `/leads/duplicates`, grouped by exact mobile, email or PAN.           |
| DM-2 | As a reviewer I want to see why two records were grouped.                     | Match signals shown in words, plus a suggested survivor and its reason.|
| DM-3 | As a reviewer I decide which record survives, not the system.                 | Radio per record; the suggestion is shown, never silently preselected. |
| DM-4 | As an RM I must not lose the conversation history on a merge.                 | Activities, tasks, documents and consent move to the survivor.        |
| DM-5 | As an RM I must not have a confirmed value silently replaced.                 | A merge only fills empty fields; conflicts are reported, not resolved. |
| DM-6 | As compliance I need to know a merge happened and why.                        | Mandatory reason, audited, plus a note on the survivor's timeline.     |
| DM-7 | As operations I must not be able to orphan an opened account.                 | A converted lead can only be the survivor.                            |
| DM-8 | As a security reviewer, merging must not reach a lead outside my scope.       | 404 on either side, never 403.                                        |

---

## 2. Where the logic lives

Every judgement is a pure function in `packages/contracts/src/merge.ts`. The service gathers
records and writes; it decides nothing.

| Function             | Answers                                                        |
| -------------------- | -------------------------------------------------------------- |
| `previewMerge`       | What the survivor looks like afterwards — gains and conflicts    |
| `canMergeLeads`      | Whether this pair may be merged at all, and why not              |
| `suggestSurvivor`    | Which record to keep by default, with its reason                 |

`previewMerge` is used by **both** the preview endpoint and the write, so the preview a reviewer
approves cannot disagree with what happens. A preview computed by different code from the write
is a preview that eventually lies.

---

## 3. The three rules

**Nothing is deleted.** The duplicate is closed as `DISQUALIFIED` with `lostReason = DUPLICATE`
and `mergedIntoId` pointing at the survivor. A lead is a record that a person spoke to SIHL; a
merge that erases one erases the evidence of that conversation.

**A merge only adds.** A field already filled on the survivor is never overwritten. Silently
replacing a mobile number somebody confirmed on a call is the one failure nobody would catch.

**Conflicts are surfaced, not resolved.** Where both hold a different non-empty value, the
survivor keeps its own and the discarded value is shown in the preview *and* written to the
audit trail — so it can still be recovered without opening the closed record.

Mergeable fields: `lastName`, `email`, `pan`, `city`, `state`, `pincode`, `estimatedValue`,
`partnerId`, `campaignId`, `eventId`. Sourcing is in that list deliberately: a duplicate created
through a partner's referral link knows who introduced the client, and losing it on merge would
cost the partner their attribution.

---

## 4. Detection

Identity keys only — exact mobile, email or PAN, via three explicit `groupBy` queries with the
caller's ABAC filter applied. Groups whose leads are not all in scope simply do not appear, so a
cross-branch duplicate surfaces for whoever can see both, which is the person who should be
deciding.

A fuzzy sweep (similar name plus same city) is deliberately **not** here. It is a different job
with a different cost profile, and floating "possibly the same" pairs at a reviewer who then has
to guess is how a review queue gets abandoned in week two.

The raw key never reaches the browser — `keyLabel` is masked. A duplicate queue that prints full
mobile numbers is a nicely paginated export of the customer book.

---

## 5. The trap worth knowing about

The merge failed on its first live run with a unique-constraint violation on `pan`.

`Lead.pan` is not unique in `schema.prisma`. It is unique in `lead_active_pan_key`, a **partial**
index created in raw SQL over active leads only (`status NOT IN (CONVERTED, LOST, DISQUALIFIED)`).
Prisma's types cannot see it, so nothing warned at compile time. Copying the PAN onto the
survivor while the duplicate still held it — and was still active — violated the index.

The fix is ordering, and it is also the correct semantics: the duplicate is closed **first**,
which drops it out of the partial index and frees the identity, and only then does the survivor
take anything from it. A merge means that record stops being a live claim on that person.

---

## 6. Known limitations

- **Pairwise only.** A group of sixteen takes fifteen merges. Fine for the real case (two or
  three records); a "merge all into this one" action is the obvious next step.
- **No unmerge.** `mergedIntoId` makes one possible — the data is all still there — but reversing
  the field gains and the moved history is its own careful piece of work.
- **Detection is capped** at 200 keys per sweep so a large book cannot hang the screen.
- **Customers are not deduplicated**, only leads. A duplicate customer means two accounts, which
  is a back-office problem before it is a CRM one.

---

## 7. Tests

| Suite                                 | Covers                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `contracts/test/merge.test.ts`        | Never overwrites, reports conflicts, survivor choice, eligibility |
| `api/test/e2e/duplicates.e2e-test.ts` | Grouping, masking, history moves, converted refusal, scope 404    |

The decisive test is `moves history and closes the duplicate as a tombstone`: it asserts the
survivor gained what it lacked, kept what it had, inherited the conversation, and that the
duplicate still exists as a closed record pointing at it.
