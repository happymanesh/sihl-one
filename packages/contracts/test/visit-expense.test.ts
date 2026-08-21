import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createVisitExpenseSchema, totalExpenseClaim } from '../src/visit';

const parse = (amount: string) =>
  createVisitExpenseSchema.safeParse({ category: 'TRAVEL', amount });

describe('expense amounts', () => {
  it('accepts ordinary rupee figures', () => {
    for (const amount of ['250', '1250.50', '0.01', '99999.99']) {
      assert.equal(parse(amount).success, true, amount);
    }
  });

  it('refuses zero and negatives', () => {
    // Zero is a mis-tap; a negative is a refund, which finance owns.
    assert.equal(parse('0').success, false);
    assert.equal(parse('-100').success, false);
  });

  it('refuses more than two decimal places', () => {
    // Paise are the smallest unit; a third digit means someone pasted a float.
    assert.equal(parse('10.999').success, false);
  });

  it('refuses text and separators', () => {
    for (const amount of ['1,250', 'abc', '₹500', '1e3', '']) {
      assert.equal(parse(amount).success, false, amount);
    }
  });

  it('refuses a claim above the ceiling', () => {
    assert.equal(parse('100001').success, false);
  });
});

describe('totalExpenseClaim', () => {
  it('sums without float drift', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    assert.equal(totalExpenseClaim(['0.10', '0.20']), '0.30');
  });

  it('handles a realistic claim', () => {
    assert.equal(totalExpenseClaim(['450.50', '120', '80.25']), '650.75');
  });

  it('returns zero for no claims', () => {
    assert.equal(totalExpenseClaim([]), '0.00');
  });
});
