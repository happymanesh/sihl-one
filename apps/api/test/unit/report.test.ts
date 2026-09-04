import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rate, reportRangeSchema } from '@sihl-one/contracts';

describe('conversion rate', () => {
  it('is a percentage to one decimal', () => {
    assert.equal(rate(1, 3), 33.3);
    assert.equal(rate(2, 3), 66.7);
    assert.equal(rate(4, 10), 40);
  });

  it('is null with no denominator, not zero', () => {
    // A rep with nothing assigned has no conversion rate. Reporting 0% would
    // sort them below everyone who genuinely failed to convert, in a table
    // that gets used in appraisals.
    assert.equal(rate(0, 0), null);
    assert.equal(rate(5, 0), null);
  });

  it('is zero when there were leads and none converted', () => {
    assert.equal(rate(0, 12), 0);
  });
});

describe('report range', () => {
  it('accepts an empty range and lets the service default it', () => {
    assert.equal(reportRangeSchema.safeParse({}).success, true);
  });

  it('accepts a normal window', () => {
    const parsed = reportRangeSchema.parse({ from: '2026-08-01', to: '2026-08-31' });
    assert.ok(parsed.from instanceof Date);
    assert.ok(parsed.to instanceof Date);
  });

  it('refuses a range that ends before it starts', () => {
    const result = reportRangeSchema.safeParse({ from: '2026-09-01', to: '2026-08-01' });
    assert.equal(result.success, false);
  });

  it('refuses a range longer than a year', () => {
    // These queries aggregate the whole lead table; an unbounded window is how
    // a report becomes the reason the CRM feels slow.
    const result = reportRangeSchema.safeParse({ from: '2024-01-01', to: '2026-01-01' });
    assert.equal(result.success, false);
  });

  it('allows exactly 366 days, so a leap year still fits', () => {
    const result = reportRangeSchema.safeParse({ from: '2024-01-01', to: '2025-01-01' });
    assert.equal(result.success, true);
  });
});
