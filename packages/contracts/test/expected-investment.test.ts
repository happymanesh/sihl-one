import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activityProductValueSchema,
  createActivitySchema,
  MAX_EXPECTED_INVESTMENT,
  totalExpectedInvestment,
} from '../src/activity';

const line = (productCode: string, expectedInvestment: string) => ({ productCode, expectedInvestment });

describe('expected investment per product', () => {
  it('accepts whole rupees and paise', () => {
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '5000')).success, true);
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '12500.50')).success, true);
  });

  it('accepts zero — an explicit "I expect nothing from this"', () => {
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '0')).success, true);
  });

  it('refuses a negative expectation', () => {
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '-100')).success, false);
  });

  it('refuses three decimal places', () => {
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '100.123')).success, false);
  });

  it('refuses comma separators, which reps type by habit', () => {
    assert.equal(activityProductValueSchema.safeParse(line('EQ', '1,25,000')).success, false);
  });

  it('refuses an amount above the typo ceiling', () => {
    assert.equal(
      activityProductValueSchema.safeParse(line('EQ', String(MAX_EXPECTED_INVESTMENT + 1))).success,
      false,
    );
  });
});

describe('totalling expected investment', () => {
  it('sums to two decimal places', () => {
    assert.equal(totalExpectedInvestment(['5000', '2500.50']), '7500.50');
  });

  it('does not lose a paisa to floating point', () => {
    // 0.1 + 0.2 is not 0.3 in binary floating point, and this figure is money.
    assert.equal(totalExpectedInvestment(['0.10', '0.20']), '0.30');
  });

  it('keeps the trailing zero, because it is printed as money', () => {
    assert.equal(totalExpectedInvestment(['450.50', '0']), '450.50');
  });

  it('is zero for nothing at all', () => {
    assert.equal(totalExpectedInvestment([]), '0.00');
  });
});

describe('logging an interaction with product values', () => {
  const base = {
    entityType: 'LEAD',
    entityId: 'cmsl2qi8t004qksts2ucwcecd',
    type: 'CALL',
    subject: 'Discussed the derivatives offering',
  };

  it('accepts an interaction with no products — most are not a pitch', () => {
    assert.equal(createActivitySchema.safeParse(base).success, true);
  });

  it('accepts several product lines', () => {
    const parsed = createActivitySchema.safeParse({
      ...base,
      productValues: [line('EQUITY', '5000'), line('FNO', '12000.50')],
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.productValues?.length, 2);
  });

  it('refuses the same product twice, which would double the forecast', () => {
    const parsed = createActivitySchema.safeParse({
      ...base,
      productValues: [line('EQUITY', '5000'), line('EQUITY', '3000')],
    });
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /only once/i);
  });
});
