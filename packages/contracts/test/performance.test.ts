import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coachingNudges,
  computeRating,
  expectedConversionRate,
  scoreBehaviour,
  upsertTargetSchema,
  type BehaviourInputs,
  type RatedLead,
} from '../src/performance';

/** Habits at target, so outcome effects can be isolated. */
const goodHabits: BehaviourInputs = {
  medianFirstResponseHours: 2,
  followUpCoverage: 0.9,
  overdueRate: 0.05,
  activitiesPerLead: 4,
  lostReasonCoverage: 1,
};

const poorHabits: BehaviourInputs = {
  medianFirstResponseHours: 30,
  followUpCoverage: 0.3,
  overdueRate: 0.5,
  activitiesPerLead: 0.4,
  lostReasonCoverage: 0.2,
};

const leads = (count: number, score: number, convertedCount: number): RatedLead[] =>
  Array.from({ length: count }, (_, index) => ({
    scoreAtAssignment: score,
    converted: index < convertedCount,
  }));

describe('expected conversion curve', () => {
  it('rises monotonically with lead score', () => {
    for (let score = 1; score <= 100; score += 1) {
      assert.ok(
        expectedConversionRate(score) > expectedConversionRate(score - 1),
        `not monotonic at ${score}`,
      );
    }
  });

  it('expects far more from a hot lead than a cold one', () => {
    // This ratio is what removes lead quality from the rating. If it were flat,
    // the whole quality adjustment would be decorative.
    assert.ok(expectedConversionRate(80) > expectedConversionRate(20) * 3);
  });

  it('stays a probability at the extremes', () => {
    for (const score of [-50, 0, 100, 500]) {
      const rate = expectedConversionRate(score);
      assert.ok(rate > 0 && rate < 1, `out of range at ${score}: ${rate}`);
    }
  });
});

describe('quality-adjusted outcome — the feedback loop defence', () => {
  it('rates a rep on cold leads above one on hot leads with a better raw rate', () => {
    // The property the whole design exists for. Raw conversion says the second
    // rep is better; adjusted for what they were handed, the first is.
    const coldSpecialist = computeRating({
      leads: leads(60, 20, 12), // 20% on cold leads
      behaviour: goodHabits,
    });
    const hotSpecialist = computeRating({
      leads: leads(60, 85, 18), // 30% on hot leads
      behaviour: goodHabits,
    });

    assert.ok(
      coldSpecialist.outcomeIndex > hotSpecialist.outcomeIndex,
      `cold ${coldSpecialist.outcomeIndex} should beat hot ${hotSpecialist.outcomeIndex}`,
    );
  });

  it('reports parity as an index near 1.0', () => {
    // 60 leads at score 50 -> expected ~0.16 each -> ~9.5 conversions.
    const rating = computeRating({ leads: leads(60, 50, 10), behaviour: goodHabits });
    assert.ok(
      rating.outcomeIndex > 0.85 && rating.outcomeIndex < 1.2,
      `expected near parity, got ${rating.outcomeIndex}`,
    );
  });

  it('does not reward simply being given more leads', () => {
    const small = computeRating({ leads: leads(20, 50, 4), behaviour: goodHabits });
    const large = computeRating({ leads: leads(200, 50, 40), behaviour: goodHabits });
    // Same rate, very different volume — the index should barely move.
    assert.ok(Math.abs(small.outcomeIndex - large.outcomeIndex) < 0.25);
  });
});

describe('shrinkage for small samples', () => {
  it('treats no leads at all as average, never as bad', () => {
    // "No evidence" must not read as poor performance — someone who just
    // joined would otherwise be rated bottom on their first day.
    const rating = computeRating({ leads: [], behaviour: goodHabits });
    assert.equal(rating.outcomeIndex, 1);
    assert.equal(rating.leadsAssessed, 0);
    assert.match(rating.explanation.join(' '), /nothing to measure/i);
  });

  it('pulls a lucky small sample back toward the average', () => {
    const luckyFew = computeRating({ leads: leads(4, 30, 3), behaviour: goodHabits });
    const sustainedMany = computeRating({ leads: leads(120, 30, 90), behaviour: goodHabits });
    assert.ok(
      sustainedMany.outcomeIndex > luckyFew.outcomeIndex,
      'sustained performance must outrank a lucky streak',
    );
  });

  it('reports confidence honestly', () => {
    assert.equal(computeRating({ leads: leads(5, 50, 1), behaviour: goodHabits }).confidence, 'LOW');
    assert.equal(computeRating({ leads: leads(20, 50, 4), behaviour: goodHabits }).confidence, 'MEDIUM');
    assert.equal(computeRating({ leads: leads(60, 50, 10), behaviour: goodHabits }).confidence, 'HIGH');
  });

  it('says so in plain language when the sample is thin', () => {
    const rating = computeRating({ leads: leads(3, 50, 0), behaviour: goodHabits });
    assert.match(rating.explanation.join(' '), /small number of leads/i);
  });
});

describe('behaviour scoring', () => {
  it('rewards good habits and penalises poor ones', () => {
    assert.ok(scoreBehaviour(goodHabits).score > 80);
    assert.ok(scoreBehaviour(poorHabits).score < 40);
  });

  it('scores every metric between 0 and 100', () => {
    for (const inputs of [goodHabits, poorHabits]) {
      for (const metric of scoreBehaviour(inputs).metrics) {
        assert.ok(metric.score >= 0 && metric.score <= 100, `${metric.code} = ${metric.score}`);
      }
    }
  });

  it('treats never contacting anyone as the worst response time, not the best', () => {
    // A null median could naively look like "zero hours". It must not.
    const never = scoreBehaviour({ ...goodHabits, medianFirstResponseHours: null });
    const fast = scoreBehaviour({ ...goodHabits, medianFirstResponseHours: 1 });
    assert.ok(never.score < fast.score);
  });

  it('separates behaviour from outcomes entirely', () => {
    // Identical leads and results, opposite habits: only behaviour moves.
    const disciplined = computeRating({ leads: leads(40, 50, 7), behaviour: goodHabits });
    const sloppy = computeRating({ leads: leads(40, 50, 7), behaviour: poorHabits });

    assert.equal(disciplined.outcomeIndex, sloppy.outcomeIndex);
    assert.ok(disciplined.behaviourScore > sloppy.behaviourScore);
    assert.ok(disciplined.overall > sloppy.overall);
  });
});

describe('overall rating', () => {
  it('stays within 0-100 for extreme inputs', () => {
    const best = computeRating({ leads: leads(200, 10, 200), behaviour: goodHabits });
    const worst = computeRating({ leads: leads(200, 90, 0), behaviour: poorHabits });
    for (const rating of [best, worst]) {
      assert.ok(rating.overall >= 0 && rating.overall <= 100, `overall ${rating.overall}`);
    }
  });

  it('does not band a new joiner as failing', () => {
    const rating = computeRating({ leads: [], behaviour: goodHabits });
    assert.notEqual(rating.band, 'DEVELOPING');
  });

  it('computes target attainment only when a target exists', () => {
    const withTarget = computeRating({
      leads: leads(20, 50, 5),
      behaviour: goodHabits,
      achievedValue: 750_000,
      targetValue: 1_000_000,
    });
    assert.equal(withTarget.targetAttainment, 75);

    const without = computeRating({ leads: leads(20, 50, 5), behaviour: goodHabits });
    assert.equal(without.targetAttainment, null);
  });

  it('never divides by a zero target', () => {
    const rating = computeRating({
      leads: leads(10, 50, 2),
      behaviour: goodHabits,
      achievedValue: 500,
      targetValue: 0,
    });
    assert.equal(rating.targetAttainment, null);
  });

  it('always explains itself', () => {
    const rating = computeRating({ leads: leads(30, 40, 3), behaviour: poorHabits });
    assert.ok(rating.explanation.length >= 2);
    assert.ok(rating.explanation.every((line) => line.length > 10));
  });
});

describe('coaching nudges', () => {
  it('targets only what the rep controls', () => {
    const rating = computeRating({ leads: leads(40, 50, 2), behaviour: poorHabits });
    const nudges = coachingNudges(rating);

    assert.ok(nudges.length > 0);
    // No nudge should tell someone to "convert more" — that is an outcome, not
    // an action, and it is the opposite of coaching.
    assert.equal(
      nudges.some((nudge) => /convert more|sell better|try harder/i.test(nudge.action)),
      false,
    );
    assert.ok(nudges.every((nudge) => nudge.action.length > 15));
  });

  it('leads with the slowest first response when that is the gap', () => {
    const rating = computeRating({
      leads: leads(40, 50, 6),
      behaviour: { ...goodHabits, medianFirstResponseHours: 40 },
    });
    assert.equal(coachingNudges(rating)[0]?.code, 'SPEED_UP_FIRST_CONTACT');
  });

  it('confirms good habits rather than inventing a problem', () => {
    const rating = computeRating({ leads: leads(40, 50, 7), behaviour: goodHabits });
    const nudges = coachingNudges(rating);
    assert.equal(nudges.length, 1);
    assert.equal(nudges[0]?.code, 'MAINTAIN');
  });

  it('says nothing about habits for someone with no leads', () => {
    const rating = computeRating({ leads: [], behaviour: goodHabits });
    assert.equal(coachingNudges(rating).length, 0);
  });
});

describe('target validation', () => {
  const valid = {
    userId: 'user-1234abcd',
    period: 'QUARTER' as const,
    periodStart: '2026-07-01',
  };

  it('accepts a target with either measure', () => {
    assert.ok(upsertTargetSchema.safeParse({ ...valid, conversionTarget: 25 }).success);
    assert.ok(upsertTargetSchema.safeParse({ ...valid, valueTarget: 5_000_000 }).success);
  });

  it('rejects a negative target', () => {
    assert.equal(upsertTargetSchema.safeParse({ ...valid, valueTarget: -1 }).success, false);
  });

  it('rejects an unknown period', () => {
    assert.equal(upsertTargetSchema.safeParse({ ...valid, period: 'WEEK' }).success, false);
  });
});
