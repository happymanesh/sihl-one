import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dailyActivityQuerySchema,
  defaultActivityDate,
  istDayWindow,
} from '@sihl-one/contracts';

describe('the day a daily report covers', () => {
  it('defaults to yesterday, not today', () => {
    // Today's row is incomplete until the day ends. A rep who spent the morning
    // at a client site and writes it up at six looks idle at four, and a
    // manager acting on that is acting on noise.
    assert.equal(defaultActivityDate(new Date('2026-09-12T06:00:00Z')), '2026-09-11');
  });

  it('uses the IST day, so late-evening UTC is already tomorrow in India', () => {
    // 19:00 UTC on the 11th is 00:30 on the 12th in Kolkata, so "yesterday"
    // is the 11th — not the 10th a UTC calculation would give.
    assert.equal(defaultActivityDate(new Date('2026-09-11T19:00:00Z')), '2026-09-11');
  });

  it('turns a date into the UTC window the database stores', () => {
    const { from, to } = istDayWindow('2026-09-11');
    // Midnight IST is 18:30 UTC the previous day.
    assert.equal(from.toISOString(), '2026-09-10T18:30:00.000Z');
    assert.equal(to.toISOString(), '2026-09-11T18:29:59.999Z');
  });

  it('covers exactly 24 hours', () => {
    const { from, to } = istDayWindow('2026-02-28');
    assert.equal(to.getTime() - from.getTime(), 86_400_000 - 1);
  });
});

describe('the date parameter', () => {
  it('accepts a plain calendar date', () => {
    assert.equal(dailyActivityQuerySchema.parse({ date: '2026-09-11' }).date, '2026-09-11');
  });

  it('accepts no date, leaving the service to default it', () => {
    assert.equal(dailyActivityQuerySchema.parse({}).date, undefined);
  });

  it('refuses a timestamp or a loose format', () => {
    for (const bad of ['2026-09-11T00:00:00Z', '11-09-2026', '2026-9-1', 'yesterday']) {
      assert.equal(dailyActivityQuerySchema.safeParse({ date: bad }).success, false, bad);
    }
  });
});
