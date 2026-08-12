# ADR-0009 — Performance ratings advise allocation; they never perform it

**Status:** Accepted · 2026-08-09

## Context

The brief asks for auto-rating of sales resources, for strong leads to be routed to the
best-rated people to raise conversion, and for weaker performers to be guided so they
improve. Those three asks pull against each other, and the tension is not incidental.

A rating computed from conversions, used to allocate the leads that produce conversions, is
a closed feedback loop. The highest-rated rep receives the best leads, converts them, and
rates higher still. A new joiner receives the leftovers, converts fewer, and rates lower —
which then justifies giving them worse leads. Within two quarters the rating has stopped
measuring salespeople and started measuring lead allocation.

## Decision

Three separate mechanisms, each with a stated job.

**1. The rating measures performance against what the leads were worth.**
`computeRating()` divides actual conversions by the conversions those specific leads should
have produced, using an expected-conversion curve over the lead score. A rep converting 20%
of cold leads outranks one converting 30% of hot leads. This removes lead quality from the
measurement, so the loop cannot express itself through the numerator.

Small samples shrink toward the average (empirical Bayes, 12 pseudo-leads). Someone with no
leads rates as average, never as failing.

**2. Behaviour is scored separately from outcomes.**
Speed of first contact, follow-up coverage, overdue rate, interactions logged, lost reasons
recorded. Every one of these is something a rep can do differently tomorrow. Outcomes are
partly luck; habits are not. Coaching targets only the behaviour half, which is why no nudge
ever says "convert more".

**3. Allocation recommends. A human assigns.**
`recommendOwners()` returns a ranked list with reasons and a full list of who was passed over
and why. It writes nothing. The manager chooses.

## Why recommend-only, and not automatic routing

Rule-based automatic routing already exists (`assignment.ts`) and is used by import, event
capture and offboarding. It routes on criteria the business wrote down and can read back.

Rating-driven routing is different in kind: it acts on an inference about a person. Three
reasons it stays advisory:

- A rating carries a confidence. Acting silently on a LOW-confidence estimate hides the
  uncertainty at exactly the point it matters.
- The feedback loop needs a circuit-breaker that can say "no, give that one to her, she is
  ready". A human is that breaker.
- A rep told that a machine took their good leads away has nobody to argue with. A rep whose
  manager made the call has a conversation, which is where coaching actually happens.

## Damping built into the recommendation

- **Headroom competes with rating.** On an ordinary lead, spreading work is weighted higher
  (0.6) than the record (0.4). Only on strong leads does the record lead (0.65).
- **Confidence discounts influence.** A LOW-confidence rating is pulled 70% of the way back to
  neutral before it affects anyone else's work.
- **Development floor.** One strong lead in four is deliberately steered to someone still
  building a record, rotated on a persisted cursor so it is even across pods and restarts.
  Without it, the people who most need evidence never get the chance to produce any.
- **The one hard gate is behavioural.** Below 55/100 on follow-up discipline, a rep is not
  offered high-value leads — because they will drop them, and that is entirely within their
  control. Withholding on a poor *outcome* index would punish bad luck instead. If the gate
  empties the list, the most disciplined of the gated reps is re-admitted with the reason
  attached: a lead still has to go to someone.

## Consequences

- Ratings are personnel information. The API serves your own scorecard and your team's, never
  a peer's, and `standing` returns a percentile band and the top score — never a ranked list
  of names.
- The peer set for `standing` is the subject's own team, not the caller's data scope. A sales
  executive has SELF scope and would otherwise be compared against nobody, which is precisely
  the question the screen exists to answer. Only three aggregate numbers cross that boundary.
- `scoreAtAssignment` is currently read as the lead's *current* score. The two diverge as a
  lead is worked. Storing the score at assignment needs a column and a backfill; it is
  recorded here as known and deliberately not faked.
- If automatic rating-driven assignment is ever wanted, it needs its own decision record. It
  cannot be enabled by flipping a flag on this one.
