import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ATTENDEE_CREDIT,
  ATTENDEE_ROLES,
  canAddAttendee,
  canConfirmAttendance,
} from '@sihl-one/contracts';

const base = {
  visitStatus: 'PLANNED',
  ownerId: 'usr_owner',
  candidateUserId: 'usr_expert',
  existingUserIds: [] as string[],
};

describe('adding a colleague to a visit', () => {
  it('allows a rep to bring a colleague with nobody else involved', () => {
    // No manager approval by design. Requiring sign-off to bring a product
    // expert to tomorrow's meeting is how the feature goes unused.
    assert.equal(canAddAttendee(base).allowed, true);
  });

  it('refuses the visit owner, who is already on it', () => {
    const result = canAddAttendee({ ...base, candidateUserId: 'usr_owner' });
    assert.equal(result.allowed, false);
    assert.match(String(result.reason), /already belongs/i);
  });

  it('refuses somebody already on the visit', () => {
    const result = canAddAttendee({ ...base, existingUserIds: ['usr_expert'] });
    assert.equal(result.allowed, false);
    assert.match(String(result.reason), /already on this visit/i);
  });

  it('refuses a completed visit, because that is rewriting history', () => {
    assert.equal(canAddAttendee({ ...base, visitStatus: 'COMPLETED' }).allowed, false);
  });

  it('refuses a cancelled visit', () => {
    assert.equal(canAddAttendee({ ...base, visitStatus: 'CANCELLED' }).allowed, false);
  });

  it('allows adding to a visit already checked in', () => {
    // Somebody turning up unexpectedly is exactly the case worth recording.
    assert.equal(canAddAttendee({ ...base, visitStatus: 'CHECKED_IN' }).allowed, true);
  });
});

describe('confirming who came', () => {
  it('is possible only once the visit is checked in', () => {
    assert.equal(canConfirmAttendance('CHECKED_IN'), true);
  });

  it('is refused before check-in and after the visit closes', () => {
    for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED', 'MISSED']) {
      assert.equal(canConfirmAttendance(status), false, status);
    }
  });
});

describe('the vocabulary and the credit rule', () => {
  it('offers the three roles the business asked for', () => {
    assert.deepEqual([...ATTENDEE_ROLES], ['SUPPORT', 'PRODUCT_EXPERT', 'MANAGER']);
  });

  it('records that credit is not divisible', () => {
    // Pinned as a test rather than left in a comment: the moment credit can be
    // split it gets negotiated over, and this is the line that stops it.
    assert.equal(ATTENDEE_CREDIT, 'owner-only');
  });
});
