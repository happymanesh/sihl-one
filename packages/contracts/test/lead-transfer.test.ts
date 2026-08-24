import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canTransferLeads, transferLeadSchema } from '../src/lead';
import { DATA_SCOPES } from '../src/enums';

/**
 * Moving a lead out of somebody's book.
 *
 * The two things worth pinning: that a rep who can only see their own leads
 * cannot hand one away, and that the reason is not satisfiable with a shrug.
 * Both are the sort of rule that gets loosened by accident later.
 */
describe('who may transfer a lead', () => {
  it('refuses a rep who can only see their own book', () => {
    assert.equal(canTransferLeads('SELF'), false);
  });

  it('allows everyone with sight of a team or wider', () => {
    for (const scope of DATA_SCOPES.filter((s) => s !== 'SELF')) {
      assert.equal(canTransferLeads(scope), true, `${scope} should be able to transfer`);
    }
  });
});

describe('the transfer reason', () => {
  it('rejects a token answer', () => {
    // The id is deliberately valid here: an invalid one would fail the parse on
    // its own and these assertions would pass without testing the reason at all.
    for (const reason of ['', '  ', 'ok', 'moved', 'as agreed']) {
      const result = transferLeadSchema.safeParse({ ownerId: 'cmsq9rjlb000g2ap72qut7yzg', reason });
      assert.equal(result.success, false, `"${reason}" should not be accepted`);
    }
  });

  it('accepts a real sentence', () => {
    const result = transferLeadSchema.safeParse({
      ownerId: 'cmsq9rjlb000g2ap72qut7yzg',
      reason: 'Client has moved to Surat and is now handled by that branch.',
    });
    assert.equal(result.success, true);
  });

  it('trims before measuring, so padding cannot pass the length check', () => {
    const result = transferLeadSchema.safeParse({ ownerId: 'cmsq9rjlb000g2ap72qut7yzg', reason: `  ok${' '.repeat(40)}` });
    assert.equal(result.success, false);
  });
});
