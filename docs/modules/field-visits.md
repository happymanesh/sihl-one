# Module: Field visits

Geo-tagged visit recording for field sales. Governed by
[ADR-0007](../adr/0007-geo-visits-privacy.md): a visit is **two discrete location
events and nothing in between**.

---

## 1. User stories

| #    | Story                                                                                        | Acceptance                                                              |
| ---- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| FV-1 | As an RM I want to plan today's visits so I know my route before I leave.                      | Planned visits appear on the Visits home, soonest first.                |
| FV-2 | As an RM I want to check in when I arrive, with one tap.                                       | Location capture starts automatically; only the photo needs a tap.      |
| FV-3 | As an RM I want to record what was discussed while it is fresh.                                | Notes are mandatory at check-out.                                       |
| FV-4 | As an RM I want to set the next follow-up without leaving the screen.                          | Follow-up field on the check-out form; it updates the lead.             |
| FV-5 | As an RM I want to resume a visit I am already in.                                             | An open visit is the largest element on the Visits home.                |
| FV-6 | As an employee I want to know I am not being tracked between visits.                           | Only two points exist in the schema, and the UI says so.                |
| SM-1 | As a manager I want to see my team's visits.                                                   | Team scope; visits are never visible branch-wide by default.            |
| SM-2 | As a manager I want to know when location evidence does not hang together.                     | Integrity assessment with plain-language reasons.                       |
| SM-3 | As a manager I must not be able to check in on someone's behalf.                               | Only the visit's owner can check in or out.                             |
| OP-1 | As compliance I want the visit on the customer's history, not in a separate report.            | Check-out writes a VISIT activity on the lead or customer timeline.     |

---

## 2. Screens

| Screen        | Route            | Notes                                                                       |
| ------------- | ---------------- | --------------------------------------------------------------------------- |
| Visits home   | `/visits`        | Mobile-first. Open visit first, then today's plan, then recent history.     |
| Plan a visit  | `/visits/new`    | Pre-fillable from a lead or customer page.                                  |
| Visit detail  | `/visits/[id]`   | Check-in / check-out panels, location evidence, photo, integrity, notes.    |

Deliberate UI decisions:

- **Location capture starts on page open.** It is the slowest step; running it
  while the user takes the photo removes the wait entirely.
- **`capture="user"`** opens the front camera directly on a phone rather than the
  gallery — faster, and harder to satisfy with an old photograph. On desktop it
  degrades to a normal file picker.
- **The submit button stays disabled with a reason underneath** ("Waiting for
  your location…", "The location reading is too imprecise"), so a disabled
  control is never a dead end.
- **Accuracy is shown as a band and a number** — "Precise · ±12 m". A coordinate
  without its uncertainty looks identical whether it came from GPS or a cell
  tower five kilometres away.

---

## 3. Data model

`visit`, plus a `VISIT` row on `activity` written at check-out. See
`apps/api/prisma/schema.prisma`.

Database constraints, because visit records feed incentive calculations and an
application bug must not be able to write an incoherent one:

| Constraint                        | Rule                                              |
| --------------------------------- | ------------------------------------------------- |
| `visit_checkout_after_checkin`     | Check-out cannot precede check-in                 |
| `visit_completed_has_both_stamps`  | A completed visit has both timestamps             |
| `visit_checkin_coords_valid`       | Coordinates are real, rejecting `0,0` GPS failures |

---

## 4. API

| Method | Path                     | Permission     | Notes                                     |
| ------ | ------------------------ | -------------- | ----------------------------------------- |
| GET    | `/visits`                | `visit:read`   | Team-scoped even for branch-scoped users  |
| GET    | `/visits/today`          | `visit:read`   | Includes any open visit, for resume       |
| GET    | `/visits/:id`            | `visit:read`   | Evidence + integrity assessment           |
| GET    | `/visits/:id/photo`      | `visit:read`   | Requires the signed token from the detail |
| POST   | `/visits`                | `visit:create` | Plan                                      |
| POST   | `/visits/:id/check-in`   | `visit:update` | Owner only                                |
| POST   | `/visits/:id/check-out`  | `visit:update` | Owner only                                |
| POST   | `/visits/:id/cancel`     | `visit:update` | Planned visits only                       |

There is **no** endpoint that records a position between check-in and check-out.

---

## 5. Validation and business rules

1. **Accuracy is required**, not optional — a coordinate must always carry its
   uncertainty.
2. **Accuracy worse than 5 km is rejected.** Such a fix carries no useful
   information and storing it would imply it did.
3. **A photo is required at check-in**, and its key must exist in storage. A
   check-in without evidence is a self-report, which the CRM already supports as
   a plain activity.
4. **Meeting notes are required at check-out.**
5. **Only the visit's owner may check in or out.** A check-in asserts that a
   named person was physically somewhere; letting anyone else record it destroys
   the meaning of the record. A manager can see the visit but not act on it.
6. **Transitions follow the table**: `PLANNED → CHECKED_IN → COMPLETED`, with
   `CANCELLED`/`MISSED` from `PLANNED` only. Completed is terminal — corrections
   are a new visit.
7. **Duration is computed server-side** from the two timestamps, never submitted.
8. **Check-out writes the meeting on to the parent timeline** and updates the
   lead's recency and follow-up date.

### Integrity assessment

Advisory, never punitive. It surfaces facts a manager can act on and never
discards a visit:

- Check-out more than 1 km from check-in **and** beyond the combined uncertainty
  of both readings. Comparing against the uncertainty is what stops a 300 m drift
  being flagged when both fixes are ±400 m.
- A check-in fix too imprecise to place the visit.
- A visit under two minutes.

---

## 6. Test cases

23 end-to-end tests plus geo unit tests, all passing. The ones that carry the
most weight:

| ID     | Case                                                          | Level    |
| ------ | ------------------------------------------------------------- | -------- |
| FV-T01 | Haversine matches a known 207 km distance and is symmetric      | contract |
| FV-T02 | Accuracy bands map correctly; a missing reading is UNRELIABLE   | contract |
| FV-T03 | Drift inside the combined uncertainty is not flagged            | contract |
| FV-T04 | A check-out in another city is flagged                          | contract |
| FV-T05 | Completed visits have no onward transition                      | contract |
| FV-T06 | Check-in without a photo is rejected                            | e2e      |
| FV-T07 | Check-in with a fabricated photo key is rejected                | e2e      |
| FV-T08 | A 99 km-accuracy fix is rejected                                | e2e      |
| FV-T09 | Another RM cannot check in on this visit                        | e2e      |
| FV-T10 | A second check-in is rejected                                   | e2e      |
| FV-T11 | Check-out before check-in is rejected                           | e2e      |
| FV-T12 | Completed visits are immutable                                  | e2e      |
| FV-T13 | The visit appears on the lead's timeline                        | e2e      |
| FV-T14 | Another executive's visit returns 404                           | e2e      |
| FV-T15 | The raw storage key is never returned — only a signed grant     | e2e      |

---

## 7. Not built yet

- Route optimisation and a map view of the day's plan.
- Voice notes: the storage path and `voiceNoteKey` column exist; recording UI and
  transcription do not.
- Offline capture. This is the screen that most needs it — a basement branch or a
  rural visit — and it is the top Phase 3 candidate. It needs a queue in
  IndexedDB plus idempotency keys on check-in and check-out so a replayed
  submission cannot create a second event.
- Automatic `MISSED` marking for planned visits that pass without a check-in.
- Manager review workflow for flagged visits (the assessment exists; the
  acknowledge/dismiss loop does not).
