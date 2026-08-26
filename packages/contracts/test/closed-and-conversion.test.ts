import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CLOSED_PERIODS, closedSince, isClosedPeriod } from '../src/lead-product';
import {
  convertProductSchema,
  guessIdentifierKind,
  looksLikePan,
} from '../src/lead-conversion';

/**
 * The Closed column's window.
 *
 * Month arithmetic is where this sort of thing goes wrong, and it goes wrong
 * quietly: a column that silently reaches back one day too far looks fine until
 * somebody reconciles a count against a report.
 */
describe('how far back Closed reaches', () => {
  it('goes back whole calendar months', () => {
    const now = new Date('2026-08-24T12:00:00Z');
    assert.equal(closedSince('1M', now).toISOString().slice(0, 10), '2026-07-24');
    assert.equal(closedSince('3M', now).toISOString().slice(0, 10), '2026-05-24');
    assert.equal(closedSince('6M', now).toISOString().slice(0, 10), '2026-02-24');
  });

  it('does not roll forward off the end of a short month', () => {
    // The trap: setMonth on 31 March minus one month gives 3 March in
    // JavaScript, because 31 February does not exist and overflows. Somebody
    // asking for "the last month" on 31 March means since 28 February.
    const march31 = new Date('2026-03-31T09:00:00Z');
    const since = closedSince('1M', march31);
    assert.equal(since.getMonth(), 1, 'should land in February, not March');
    assert.ok(since.getDate() <= 28, `landed on ${since.getDate()} February`);
  });

  it('handles a leap February', () => {
    const march31 = new Date('2024-03-31T09:00:00Z');
    const since = closedSince('1M', march31);
    assert.equal(since.getMonth(), 1);
    assert.equal(since.getDate(), 29, 'should use the real last day of a leap February');
  });

  it('recognises only the three offered periods', () => {
    for (const p of CLOSED_PERIODS) assert.equal(isClosedPeriod(p), true);
    for (const p of ['12M', '1m', '', 'ALL', null, 30]) {
      assert.equal(isClosedPeriod(p), false, `${String(p)} should be rejected`);
    }
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
