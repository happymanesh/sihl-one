import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEVELOPING_RATING_CEILING,
  MIN_BEHAVIOUR_FOR_STRONG_LEADS,
  recommendOwners,
  type AllocationCandidate,
} from '../src/allocation';

const candidate = (over: Partial<AllocationCandidate> & { userId: string }): AllocationCandidate => ({
  fullName: over.userId,
  overall: 60,
  behaviourScore: 80,
  confidence: 'HIGH',
  openLeads: 10,
  capacity: 60,
  isAvailable: true,
  ...over,
});

const strongLead = { score: 85 };
const ordinaryLead = { score: 40 };

describe('eligibility', () => {
  it('excludes unavailable people with the caller’s reason', () => {
    const advice = recommendOwners(strongLead, [
      candidate({ userId: 'a' }),
      candidate({ userId: 'b', isAvailable: false, unavailableReason: 'On notice period' }),
    ]);

    assert.equal(advice.recommendations.length, 1);
    assert.deepEqual(advice.excluded, [
      { userId: 'b', fullName: 'b', reason: 'On notice period' },
    ]);
  });

  it('excludes anyone already at capacity', () => {
    const advice = recommendOwners(ordinaryLead, [
      candidate({ userId: 'full', openLeads: 60, capacity: 60 }),
      candidate({ userId: 'free', openLeads: 5 }),
    ]);

    assert.equal(advice.recommendations[0]?.userId, 'free');
    assert.match(advice.excluded[0]?.reason ?? '', /at capacity/i);
  });

  it('always says who was passed over and why', () => {
    // A list a manager cannot challenge is a list they will not trust.
    const advice = recommendOwners(strongLead, [
      candidate({ userId: 'a' }),
      candidate({ userId: 'b', behaviourScore: 20 }),
    ]);
    assert.equal(advice.excluded.length, 1);
    assert.ok((advice.excluded[0]?.reason.length ?? 0) > 20);
  });
});

describe('the behaviour gate', () => {
  it('keeps strong leads away from poor follow-up discipline', () => {
    const advice = recommendOwners(strongLead, [
      candidate({ userId: 'sloppy', overall: 95, behaviourScore: MIN_BEHAVIOUR_FOR_STRONG_LEADS - 1 }),
      candidate({ userId: 'steady', overall: 60, behaviourScore: 85 }),
    ]);

    assert.equal(advice.recommendations.length, 1);
    assert.equal(advice.recommendations[0]?.userId, 'steady');
  });

  it('does not apply the gate to ordinary leads', () => {
    // The gate withholds *valuable* work. Applying it everywhere would leave
    // someone with nothing to improve on, which is the opposite of coaching.
    const advice = recommendOwners(ordinaryLead, [
      candidate({ userId: 'sloppy', behaviourScore: 20 }),
    ]);
    assert.equal(advice.recommendations.length, 1);
    assert.equal(advice.excluded.length, 0);
  });

  it('gates on behaviour and never on outcomes', () => {
    // A low outcome index can be bad luck; poor habits cannot.
    const unlucky = candidate({ userId: 'unlucky', overall: 30, behaviourScore: 90 });
    const advice = recommendOwners(strongLead, [unlucky]);
    assert.equal(advice.recommendations.length, 1);
  });
});

describe('fit scoring', () => {
  it('weights the record more heavily on a strong lead', () => {
    const performer = candidate({ userId: 'performer', overall: 90, openLeads: 40 });
    const empty = candidate({ userId: 'empty', overall: 45, openLeads: 0 });
    // Cursor 1 is not a development slot, so this isolates raw fit.
    const offRotation = { developmentCursor: 1 };

    assert.equal(
      recommendOwners(strongLead, [performer, empty], offRotation).recommendations[0]?.userId,
      'performer',
    );
    // Same two people, ordinary lead: spreading the work wins.
    assert.equal(
      recommendOwners(ordinaryLead, [performer, empty], offRotation).recommendations[0]?.userId,
      'empty',
    );
  });

  it('discounts a rating built on almost no evidence', () => {
    const unproven = candidate({ userId: 'unproven', overall: 95, confidence: 'LOW', openLeads: 20 });
    const proven = candidate({ userId: 'proven', overall: 75, confidence: 'HIGH', openLeads: 20 });

    const advice = recommendOwners(strongLead, [unproven, proven]);
    assert.equal(advice.recommendations[0]?.userId, 'proven');
  });

  it('explains every recommendation', () => {
    const advice = recommendOwners(strongLead, [candidate({ userId: 'a', overall: 80 })]);
    assert.ok(advice.recommendations[0]!.reasons.length >= 2);
  });

  it('is stable when two people score identically', () => {
    const pair = [candidate({ userId: 'zoe', fullName: 'Zoe' }), candidate({ userId: 'amy', fullName: 'Amy' })];
    const first = recommendOwners(strongLead, pair).recommendations.map((r) => r.userId);
    const second = recommendOwners(strongLead, [...pair].reverse()).recommendations.map((r) => r.userId);
    assert.deepEqual(first, second);
  });
});

describe('the development floor', () => {
  const developing = candidate({
    userId: 'newjoiner',
    overall: DEVELOPING_RATING_CEILING - 15,
    behaviourScore: 80,
    openLeads: 5,
  });
  const star = candidate({ userId: 'star', overall: 92, openLeads: 5 });

  it('promotes a developing rep on the rotation slot', () => {
    const advice = recommendOwners(strongLead, [star, developing], { developmentCursor: 0 });
    assert.equal(advice.recommendations[0]?.userId, 'newjoiner');
    assert.equal(advice.recommendations[0]?.isDevelopmentPick, true);
    assert.equal(advice.developmentFloorApplied, true);
  });

  it('leaves the other strong leads with the best fit', () => {
    for (const cursor of [1, 2, 3]) {
      const advice = recommendOwners(strongLead, [star, developing], { developmentCursor: cursor });
      assert.equal(advice.recommendations[0]?.userId, 'star', `cursor ${cursor}`);
      assert.equal(advice.developmentFloorApplied, false);
    }
  });

  it('reserves roughly one strong lead in four', () => {
    const promoted = Array.from({ length: 20 }, (_, cursor) =>
      recommendOwners(strongLead, [star, developing], { developmentCursor: cursor }),
    ).filter((advice) => advice.developmentFloorApplied).length;
    assert.equal(promoted, 5);
  });

  it('never bypasses the behaviour gate to make its pick', () => {
    // The floor exists to give people a chance, not to hand a valuable lead to
    // someone who is not working the ones they have.
    const undisciplined = candidate({ userId: 'lax', overall: 30, behaviourScore: 20 });
    const advice = recommendOwners(strongLead, [star, undisciplined], { developmentCursor: 0 });
    assert.equal(advice.recommendations[0]?.userId, 'star');
    assert.equal(advice.developmentFloorApplied, false);
  });

  it('does nothing on ordinary leads', () => {
    const advice = recommendOwners(ordinaryLead, [star, developing], { developmentCursor: 0 });
    assert.equal(advice.developmentFloorApplied, false);
  });

  it('does nothing when the developing rep already leads on fit', () => {
    // Nearly full and only average, so the developing rep wins on fit alone and
    // the floor has nothing to correct.
    const loaded = candidate({ userId: 'loaded', overall: 60, openLeads: 59 });
    const advice = recommendOwners(strongLead, [loaded, developing], { developmentCursor: 0 });
    assert.equal(advice.recommendations[0]?.userId, 'newjoiner');
    assert.equal(advice.recommendations[0]?.isDevelopmentPick, false);
    assert.equal(advice.developmentFloorApplied, false);
  });
});

describe('recommend mode', () => {
  it('never returns an assignment, only ranked suggestions', () => {
    const advice = recommendOwners(strongLead, [candidate({ userId: 'a' }), candidate({ userId: 'b' })]);
    assert.match(advice.note, /nothing is assigned/i);
    assert.deepEqual(
      advice.recommendations.map((r) => r.rank),
      [1, 2],
    );
  });

  it('says plainly when there is nobody to suggest', () => {
    const advice = recommendOwners(strongLead, [candidate({ userId: 'a', openLeads: 99 })]);
    assert.equal(advice.recommendations.length, 0);
    assert.match(advice.note, /nobody/i);
  });

  it('caps the list so it stays a decision, not a directory', () => {
    const many = Array.from({ length: 12 }, (_, index) => candidate({ userId: `u${index}` }));
    assert.equal(recommendOwners(strongLead, many).recommendations.length, 3);
    assert.equal(recommendOwners(strongLead, many, { maxRecommendations: 5 }).recommendations.length, 5);
  });
});

describe('when the gate would leave nobody', () => {
  it('re-admits the most disciplined of the people it caught', () => {
    // A lead still has to go to someone. "Nobody" with four people sitting
    // there is a screen a manager overrides once and then stops opening.
    const advice = recommendOwners(strongLead, [
      candidate({ userId: 'worst', behaviourScore: 20 }),
      candidate({ userId: 'least-bad', behaviourScore: 50 }),
    ]);

    assert.equal(advice.recommendations.length, 1);
    assert.equal(advice.recommendations[0]?.userId, 'least-bad');
    assert.equal(advice.excluded.length, 1);
  });

  it('says why the pick is a compromise', () => {
    const advice = recommendOwners(strongLead, [candidate({ userId: 'only', behaviourScore: 30 })]);
    assert.match(advice.recommendations[0]!.reasons[0]!, /below the follow-up bar/i);
    assert.match(advice.recommendations[0]!.reasons[0]!, /brief them/i);
  });

  it('does not re-admit anyone who is unavailable or full', () => {
    // Capacity and availability are facts, not judgements — the fallback only
    // relaxes the judgement.
    const advice = recommendOwners(strongLead, [
      candidate({ userId: 'gone', isAvailable: false, unavailableReason: 'Serving notice period' }),
      candidate({ userId: 'full', openLeads: 60 }),
    ]);
    assert.equal(advice.recommendations.length, 0);
    assert.equal(advice.excluded.length, 2);
  });
});
