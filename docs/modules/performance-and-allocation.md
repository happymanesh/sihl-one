# Module: Performance, coaching and smart allocation

Auto-rating of sales resources, coaching derived from it, and lead allocation advice.
Governed by [ADR-0009](../adr/0009-rating-drives-advice-not-allocation.md): **the rating
advises allocation; it never performs it.**

---

## 1. User stories

| #    | Story                                                                                    | Acceptance                                                                        |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| PF-1 | As an RM I want to know how I am doing without waiting for an appraisal.                   | `/performance` shows a rating, its inputs and its confidence.                      |
| PF-2 | As an RM I want the rating to account for the leads I was actually given.                  | Outcome index is actual ÷ expected conversions for those leads' scores.            |
| PF-3 | As an RM I want to know exactly what to change.                                            | Nudges name a behaviour, its current value, its target and a concrete next action. |
| PF-4 | As an RM I want to see where I stand against my team.                                      | Percentile band, team median, top score, gap to top — no names, no ranked list.     |
| PF-5 | As a new joiner I do not want "no evidence" to read as "bad".                              | Zero leads rates as average with LOW confidence, never as DEVELOPING.               |
| PF-6 | As an RM I want to see target progress relative to how far through the period we are.      | Attainment shown beside expected pace.                                             |
| SM-1 | As a sales manager I want to set targets for my team.                                      | `POST /performance/targets`, one per person per period start.                      |
| SM-2 | As a sales manager I want to read my team members' scorecards.                             | `GET /performance/users/:id`, restricted to my reports.                            |
| SM-3 | As an RM I must not be able to read a peer's rating.                                       | 403. A rating is personnel information.                                            |
| AL-1 | As a sales manager I want help deciding who should get a valuable lead.                    | Ranked suggestions with reasons on the Assign tab.                                 |
| AL-2 | As a sales manager I want to know who was passed over and why.                             | Full exclusion list with a reason each, expandable.                                |
| AL-3 | As a manager I want the system to suggest, not decide.                                     | Choosing a suggestion fills the picker; it does not submit.                        |
| AL-4 | As a developing rep I want a fair share of good leads so I can build a record.             | One strong lead in four is reserved by the development floor.                      |
| AL-5 | As a manager I do not want a valuable lead going to someone who is not working their book. | Behaviour gate at 55/100 on strong leads, with a re-admission fallback.            |

---

## 2. Screens

| Screen              | Route                       | Notes                                                       |
| ------------------- | --------------------------- | ----------------------------------------------------------- |
| My performance      | `/performance`              | Rating, explanation, target pacing, habits, nudges, standing |
| Where you stand     | `/dashboard`                | Three-number strip plus the single biggest lever             |
| Suggested owners    | `/leads/[id]` → Assign tab  | Fetched on demand; fails silently to the plain picker        |

Deliberate UI decisions:

- **The rating is shown with its explanation, always.** A score nobody can interrogate gets
  dismissed by a sales floor — correctly, because it is being read as a judgement of their
  work.
- **Habits get a progress meter, outcomes get a number.** The meter is where the user has
  agency; making outcomes look equally controllable would be dishonest.
- **Standing shows a gap, not a rank.** "35 points behind the top" is actionable. "4th of 5"
  demotivates everyone below the median and tells them nothing.
- **The suggestions panel degrades to nothing on error.** Assignment must not become
  unavailable because a rating could not be computed.

---

## 3. Where the logic lives

Every judgement is a pure function in `@sihl-one/contracts`, imported by the API. The service
layer gathers facts and nothing else. That split matters more here than anywhere else in the
product: this rating is read as an assessment of a person, so the reasoning behind it has to
be reviewable by someone who does not read NestJS.

| File                            | Contains                                                              |
| ------------------------------- | --------------------------------------------------------------------- |
| `contracts/performance.ts`      | `expectedConversionRate`, `scoreBehaviour`, `computeRating`, `coachingNudges`, target schema |
| `contracts/allocation.ts`       | `recommendOwners`, gates, fit scoring, development floor              |
| `api/performance.service.ts`    | Fact gathering: leads, activities, follow-up dates, targets, peers    |
| `api/allocation.service.ts`     | Candidate discovery, availability, rotation cursor                    |

---

## 4. The rating, in order

1. **Expected conversions.** `0.02 + (score/100)^1.5 × 0.4` per lead, summed. A score-80 lead
   is expected to convert more than three times as often as a score-20 lead.
2. **Outcome index.** `(actual + prior) ÷ (expected + prior)`, where `prior = 12 × 0.15`.
   1.0 means "exactly as well as these leads should have done".
3. **Behaviour score.** Five metrics, each 0–100, each something the rep controls.
4. **Overall.** Outcome and behaviour combined, clamped 0–100, banded
   EXCEPTIONAL / STRONG / ON_TRACK / DEVELOPING.
5. **Confidence.** LOW under 10 leads, MEDIUM under 40, HIGH above. Stated on every card.

Behaviour metrics and their targets:

| Code                 | Measures                                | Target                |
| -------------------- | --------------------------------------- | --------------------- |
| `FIRST_RESPONSE`     | Median hours to first human interaction | Under 4 hours         |
| `FOLLOW_UP_COVERAGE` | Open leads with a next follow-up date   | Above 85%             |
| `OVERDUE`            | Open leads past their committed date    | Under 10%             |
| `ENGAGEMENT`         | Interactions logged per lead            | 3 or more             |
| `LOST_REASONS`       | Lost leads with a reason recorded       | Every one             |

Median, not mean, on first response: one lead contacted three weeks late would otherwise drag
a whole quarter's figure and make it unactionable.

---

## 5. Allocation advice

`GET /leads/:id/owner-suggestions` (`lead:assign`, scoped read).

Order of operations:

1. **Availability** — inactive, offboarded, serving notice, or already the owner → excluded
   with that reason.
2. **Capacity** — 60 open leads. A lead handed to someone carrying sixty does not get worked,
   it gets aged.
3. **Behaviour gate** — strong leads only (score ≥ 70), below 55/100 → excluded. If this
   empties the list, the most disciplined of the gated reps is re-admitted, flagged, with the
   reason carried into their recommendation.
4. **Fit score** — `trustedRating × w + headroom × 100 × (1−w)`, where `w` is 0.65 on strong
   leads and 0.4 otherwise. `trustedRating` pulls the rating toward 50 by confidence.
5. **Development floor** — on every fourth strong lead, the best developing rep (overall < 55)
   who cleared the gate is promoted to rank 1 and flagged. Skipped if they already lead.
6. **Top three**, each with reasons; everyone else in `excluded` with a reason.

The rotation cursor lives in the `counter` table and advances when a strong lead is actually
assigned — not when advice is viewed. Advancing it on view would burn the reserved slot every
time someone opened the same lead twice, and the one-in-four floor would quietly never deliver.

---

## 6. Privacy and access

| Rule                                            | Enforced by                                          |
| ----------------------------------------------- | ---------------------------------------------------- |
| Your own scorecard                               | `GET /performance/me`                                |
| Your team's scorecards                           | `GET /performance/users/:id` — 403 for a peer         |
| Manager reads are audited                        | `audit.record` on every non-self read                |
| No ranked list of colleagues is ever returned    | `standing` carries three aggregate numbers, no names |
| Suggestions never expose leads outside your scope| Scoped `lead.findFirst` before any advice is computed |

---

## 7. Known limitations

- `scoreAtAssignment` is read as the lead's current score. They diverge as a lead is worked.
  A dedicated column and a backfill would fix it; that is deliberately not faked.
- Capacity is a constant (60). It should become a per-designation or per-user setting.
- The rating window is fixed at 90 days.
- `standingFor` rates each peer individually, so a 50-person team is 200 queries. Fine at
  SIHL's size; it needs a materialised daily rollup before it is not.

---

## 8. Tests

| Suite                                | Covers                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `contracts/test/performance.test.ts` | Curve monotonicity, the cold-vs-hot property, shrinkage, nudge quality    |
| `contracts/test/allocation.test.ts`  | Gates, fit weighting, floor rotation (5 in 20), fallback, stability       |
| `api/test/e2e/performance.e2e-test.ts` | Peer refusal, no names in standing, advice assigns nobody, scope 404s   |

The decisive test is `rates a rep on cold leads above one on hot leads with a better raw
rate`. If that ever fails, the quality adjustment has become decorative and the feedback loop
described in ADR-0009 is live.
