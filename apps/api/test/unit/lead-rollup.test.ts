import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rollUpLeadStatus, type LeadProductStatus } from '@sihl-one/contracts';

/**
 * The rule the product owner asked to confirm: once no product is still open,
 * a lead is CONVERTED if any product converted and LOST if none did.
 *
 * The rule itself was already correct. What was missing sat around it — the
 * lead kept its stale `nextFollowUpAt` and never had `convertedAt` stamped, so
 * a fully-closed lead still appeared in the overdue list and was invisible to
 * conversion reporting. Those live in `LeadsService.rollUpLead`; these cases
 * pin the decision this all hangs off.
 */
const s = (...statuses: string[]) => statuses as LeadProductStatus[];

describe('lead status rolled up from its products', () => {
  it('is CONVERTED when every product is closed and one converted', () => {
    assert.equal(rollUpLeadStatus(s('CONVERTED', 'LOST', 'LOST')), 'CONVERTED');
  });

  it('is CONVERTED even when only one of many converted', () => {
    // A client who bought equity and declined the rest converted. Reporting
    // them lost because most products failed would be wrong.
    assert.equal(rollUpLeadStatus(s('LOST', 'LOST', 'LOST', 'CONVERTED')), 'CONVERTED');
  });

  it('is LOST when every product is closed and none converted', () => {
    assert.equal(rollUpLeadStatus(s('LOST', 'LOST')), 'LOST');
  });

  it('is DISQUALIFIED only when that is the whole story', () => {
    assert.equal(rollUpLeadStatus(s('DISQUALIFIED', 'DISQUALIFIED')), 'DISQUALIFIED');
  });

  it('prefers LOST over DISQUALIFIED when both appear', () => {
    assert.equal(rollUpLeadStatus(s('DISQUALIFIED', 'LOST')), 'LOST');
  });

  it('stays open while any product is still in play', () => {
    // One converted product does not close a lead somebody is still working.
    assert.equal(rollUpLeadStatus(s('CONVERTED', 'PROPOSAL')), 'PROPOSAL');
    assert.equal(rollUpLeadStatus(s('LOST', 'NEW')), 'NEW');
  });

  it('reports the furthest-advanced open product, not the first', () => {
    assert.equal(rollUpLeadStatus(s('NEW', 'PROPOSAL', 'CONTACTED')), 'PROPOSAL');
  });

  it('leaves a lead with no products alone', () => {
    // Plenty of leads are a name and a number for a week. Null means "do not
    // touch the lead's own status".
    assert.equal(rollUpLeadStatus([]), null);
  });
});
