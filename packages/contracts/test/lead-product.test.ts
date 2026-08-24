import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  changeLeadProductStatusSchema,
  isOpenLeadProductStatus,
  rollUpLeadStatus,
  shouldCreateCustomer,
} from '../src/lead-product';

/**
 * Per-product outcomes on one lead.
 *
 * The worked example from the national sales head: equity closes on one date,
 * F&O on another, mutual funds never. Every case below is a shape that example
 * produces, plus the ones that would quietly misreport a client if the roll-up
 * were written the obvious way.
 */
describe('rolling a lead up from its products', () => {
  it('leaves the lead alone when it has no products yet', () => {
    assert.equal(rollUpLeadStatus([]), null);
  });

  it('reflects the furthest-advanced product while anything is open', () => {
    assert.equal(rollUpLeadStatus(['NEW', 'PROPOSAL', 'CONTACTED']), 'PROPOSAL');
    assert.equal(rollUpLeadStatus(['NEW', 'CONTACTED']), 'CONTACTED');
  });

  it('does not let a closed product outrank open work', () => {
    // The lead is not converted just because one product is: two conversations
    // are still live, and a rep whose pipeline dropped the lead would stop
    // working them.
    assert.equal(rollUpLeadStatus(['CONVERTED', 'QUALIFIED']), 'QUALIFIED');
    assert.equal(rollUpLeadStatus(['LOST', 'NEW']), 'NEW');
  });

  it('reports a client who bought one thing as converted, not lost', () => {
    // The worked example, finished: equity taken, F&O taken, mutual funds
    // declined. Reporting this as LOST because something was declined would
    // misstate the outcome, and the numbers are read by people who pay bonuses.
    assert.equal(rollUpLeadStatus(['CONVERTED', 'CONVERTED', 'DISQUALIFIED']), 'CONVERTED');
    assert.equal(rollUpLeadStatus(['CONVERTED', 'LOST']), 'CONVERTED');
  });

  it('prefers lost over disqualified when nothing was won', () => {
    assert.equal(rollUpLeadStatus(['LOST', 'DISQUALIFIED']), 'LOST');
    assert.equal(rollUpLeadStatus(['DISQUALIFIED', 'DISQUALIFIED']), 'DISQUALIFIED');
  });

  it('agrees with itself about which statuses are open', () => {
    for (const status of ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'] as const) {
      assert.equal(isOpenLeadProductStatus(status), true, `${status} should be open`);
      assert.equal(rollUpLeadStatus([status]), status);
    }
    for (const status of ['CONVERTED', 'LOST', 'DISQUALIFIED'] as const) {
      assert.equal(isOpenLeadProductStatus(status), false, `${status} should be closed`);
    }
  });
});

describe('when a conversion creates the customer', () => {
  it('creates one on the first product converted', () => {
    assert.equal(shouldCreateCustomer(null, ['QUALIFIED', 'PROPOSAL']), true);
  });

  it('does not create a second for the next product', () => {
    // One client is one customer, however many products they take. A second
    // record would split their history exactly where it matters.
    assert.equal(shouldCreateCustomer('cus_1', ['CONVERTED', 'PROPOSAL']), false);
    assert.equal(shouldCreateCustomer(null, ['CONVERTED', 'PROPOSAL']), false);
  });
});

describe('closing a product', () => {
  it('demands a reason for lost, as the lead-level rule does', () => {
    const missing = changeLeadProductStatusSchema.safeParse({
      productCode: 'EQUITY',
      status: 'LOST',
    });
    assert.equal(missing.success, false);

    const given = changeLeadProductStatusSchema.safeParse({
      productCode: 'EQUITY',
      status: 'LOST',
      lostReason: 'PRICE',
    });
    assert.equal(given.success, true);
  });

  it('does not demand one for disqualified', () => {
    const result = changeLeadProductStatusSchema.safeParse({
      productCode: 'MUTUAL_FUNDS',
      status: 'DISQUALIFIED',
    });
    assert.equal(result.success, true);
  });
});
