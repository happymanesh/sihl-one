import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLOSED_PERIODS,
  DEFAULT_CLOSED_PERIOD,
  closedSince,
  isClosedPeriod,
} from '../src/lead-product';
import {
  convertProductSchema,
  guessIdentifierKind,
  looksLikePan,
} from '../src/lead-conversion';

/**
 * The Closed column's window.
 *
 * Rolling days rather than calendar months, because "last month" reads as the
 * previous calendar month and meant something else. These pin the arithmetic
 * and, more importantly, pin the vocabulary: a period that stops saying what it
 * does is how a count quietly stops matching a report.
 */
describe('how far back Closed reaches', () => {
  const noon = new Date('2026-08-24T12:00:00Z');

  it('counts back the number of days it says', () => {
    assert.equal(closedSince('30D', noon).toISOString().slice(0, 10), '2026-07-25');
    assert.equal(closedSince('60D', noon).toISOString().slice(0, 10), '2026-06-25');
    assert.equal(closedSince('90D', noon).toISOString().slice(0, 10), '2026-05-26');
  });

  it('keeps the time of day, so the window does not jump at midnight', () => {
    // Measured back from the moment it is called. Snapping to midnight would
    // let the column change its own count while somebody was looking at it.
    assert.equal(closedSince('30D', noon).toISOString().slice(11, 19), '12:00:00');
  });

  it('crosses a month end and a leap February without special handling', () => {
    // The calendar-month version needed clamping here: 31 March minus one month
    // overflowed to 3 March. Days have no such edge.
    const march31 = new Date('2024-03-31T09:00:00Z');
    assert.equal(closedSince('30D', march31).toISOString().slice(0, 10), '2024-03-01');
    assert.equal(closedSince('60D', march31).toISOString().slice(0, 10), '2024-01-31');
  });

  it('is always in the past, never ahead of now', () => {
    for (const period of CLOSED_PERIODS) {
      assert.ok(closedSince(period, noon) < noon, `${period} should look backwards`);
    }
  });

  it('widens as the period grows', () => {
    assert.ok(closedSince('90D', noon) < closedSince('60D', noon));
    assert.ok(closedSince('60D', noon) < closedSince('30D', noon));
  });

  it('recognises only the three offered periods', () => {
    for (const p of CLOSED_PERIODS) assert.equal(isClosedPeriod(p), true);
    // '1M' is deliberately here: bookmarks from the calendar-month version must
    // fall back to the default rather than being honoured or throwing.
    for (const p of ['1M', '3M', '6M', '30d', '', 'ALL', null, 30]) {
      assert.equal(isClosedPeriod(p), false, `${String(p)} should be rejected`);
    }
  });

  it('defaults to the shortest window', () => {
    assert.equal(DEFAULT_CLOSED_PERIOD, '30D');
    assert.equal(isClosedPeriod(DEFAULT_CLOSED_PERIOD), true);
  });
});

/**
 * Closing a product from the interaction form.
 *
 * The point of this path is that it accepts what the rep has to hand. Every
 * assertion below is really the same one: do not reject a conversion over the
 * shape of a reference the back office owns anyway.
 */
describe('the conversion identifier', () => {
  const base = { productCode: 'EQUITY', identifierKind: 'CLIENT_CODE' as const };

  it('accepts a client code that looks nothing like a PAN', () => {
    for (const identifier of ['R0018', 'SIHL-99213', '4471192']) {
      const result = convertProductSchema.safeParse({ ...base, identifier });
      assert.equal(result.success, true, `${identifier} should be accepted`);
    }
  });

  it('accepts a PAN, and uppercases it', () => {
    const result = convertProductSchema.safeParse({
      productCode: 'EQUITY',
      identifierKind: 'PAN',
      identifier: 'abcde1234f',
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.identifier, 'ABCDE1234F');
  });

  it('still refuses an empty or spaced reference', () => {
    for (const identifier of ['', '  ', 'AB', 'ABCDE 1234F']) {
      const result = convertProductSchema.safeParse({ ...base, identifier });
      assert.equal(result.success, false, `"${identifier}" should be refused`);
    }
  });

  it('guesses the kind without enforcing it', () => {
    assert.equal(looksLikePan('ABCDE1234F'), true);
    assert.equal(looksLikePan('R0018'), false);
    assert.equal(guessIdentifierKind('abcde1234f'), 'PAN');
    assert.equal(guessIdentifierKind('SIHL-99213'), 'CLIENT_CODE');

    // A client code that happens to be PAN-shaped is still a client code if the
    // rep says so — the guess only pre-fills the toggle.
    const result = convertProductSchema.safeParse({
      productCode: 'EQUITY',
      identifierKind: 'CLIENT_CODE',
      identifier: 'ABCDE1234F',
    });
    assert.equal(result.success, true);
  });
});

describe('the final amount', () => {
  const base = { productCode: 'EQUITY', identifier: 'R0018', identifierKind: 'CLIENT_CODE' as const };

  it('is optional — a conversion without a figure still records', () => {
    assert.equal(convertProductSchema.safeParse(base).success, true);
  });

  it('takes rupees and paise as a string, never a float', () => {
    assert.equal(convertProductSchema.safeParse({ ...base, finalAmount: '250000' }).success, true);
    assert.equal(convertProductSchema.safeParse({ ...base, finalAmount: '250000.50' }).success, true);
  });

  it('refuses what is not an amount', () => {
    for (const finalAmount of ['-5', '1.234', 'Rs 2000', '2,50,000', '']) {
      assert.equal(
        convertProductSchema.safeParse({ ...base, finalAmount }).success,
        false,
        `${finalAmount} should be refused`,
      );
    }
  });
});
