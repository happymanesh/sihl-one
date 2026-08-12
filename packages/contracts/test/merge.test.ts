import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canMergeLeads,
  mergeLeadsSchema,
  previewMerge,
  suggestSurvivor,
  type MergeableRecord,
} from '../src/merge';

const lead = (over: Partial<MergeableRecord> & { id: string }): MergeableRecord => ({
  reference: `LD-${over.id}`,
  status: 'NEW',
  createdAt: '2026-01-01T00:00:00.000Z',
  activityCount: 0,
  ...over,
});

describe('merge preview', () => {
  it('fills in what the survivor was missing', () => {
    const preview = previewMerge(
      lead({ id: 'a', email: null, city: null }),
      lead({ id: 'b', email: 'x@y.in', city: 'Surat' }),
    );

    assert.equal(preview.gains.length, 2);
    assert.equal(preview.fields.find((f) => f.field === 'email')?.value, 'x@y.in');
    assert.equal(preview.conflicts.length, 0);
  });

  it('never overwrites a value the survivor already holds', () => {
    // Silently replacing a mobile somebody confirmed on a call is the one
    // failure nobody would catch.
    const preview = previewMerge(
      lead({ id: 'a', email: 'confirmed@sihl.in' }),
      lead({ id: 'b', email: 'stale@old.in' }),
    );

    const email = preview.fields.find((f) => f.field === 'email');
    assert.equal(email?.value, 'confirmed@sihl.in');
    assert.equal(email?.gained, false);
  });

  it('reports the discarded value rather than dropping it silently', () => {
    const preview = previewMerge(
      lead({ id: 'a', pan: 'ABCPZ1234Q' }),
      lead({ id: 'b', pan: 'ZZZPZ9999Z' }),
    );

    assert.equal(preview.conflicts.length, 1);
    assert.equal(preview.conflicts[0]?.field, 'pan');
    assert.equal(preview.conflicts[0]?.discarded, 'ZZZPZ9999Z');
  });

  it('does not call an identical value a conflict', () => {
    const preview = previewMerge(
      lead({ id: 'a', city: 'Ahmedabad' }),
      lead({ id: 'b', city: 'Ahmedabad' }),
    );
    assert.equal(preview.conflicts.length, 0);
    assert.equal(preview.gains.length, 0);
  });

  it('treats an empty string as missing, not as a value', () => {
    const preview = previewMerge(lead({ id: 'a', city: '' }), lead({ id: 'b', city: 'Vadodara' }));
    assert.equal(preview.fields.find((f) => f.field === 'city')?.value, 'Vadodara');
  });

  it('carries sourcing across when the survivor has none', () => {
    // A duplicate created from a partner's link knows who introduced the
    // client; losing that on merge costs the partner their attribution.
    const preview = previewMerge(
      lead({ id: 'a', partnerId: null }),
      lead({ id: 'b', partnerId: 'partner-1' }),
    );
    assert.equal(preview.fields.find((f) => f.field === 'partnerId')?.value, 'partner-1');
  });
});

describe('eligibility', () => {
  it('refuses to merge a lead into itself', () => {
    const same = lead({ id: 'a' });
    assert.equal(canMergeLeads(same, same).ok, false);
  });

  it('refuses to merge away a converted lead', () => {
    // It has a customer hanging off it that may already be in the back office.
    const result = canMergeLeads(
      lead({ id: 'a' }),
      lead({ id: 'b', status: 'CONVERTED', customerId: 'cust-1' }),
    );
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /converted/i);
    assert.match(result.reason ?? '', /other record into this one/i);
  });

  it('allows a converted lead to be the survivor', () => {
    assert.equal(
      canMergeLeads(lead({ id: 'a', status: 'CONVERTED', customerId: 'c' }), lead({ id: 'b' })).ok,
      true,
    );
  });

  it('refuses a record that has already been merged', () => {
    assert.equal(canMergeLeads(lead({ id: 'a' }), lead({ id: 'b', mergedIntoId: 'c' })).ok, false);
    assert.equal(canMergeLeads(lead({ id: 'a', mergedIntoId: 'c' }), lead({ id: 'b' })).ok, false);
  });
});

describe('choosing a survivor', () => {
  it('prefers the converted record', () => {
    const converted = lead({ id: 'a', status: 'CONVERTED', activityCount: 0 });
    const other = lead({ id: 'b', activityCount: 20 });
    assert.equal(suggestSurvivor(other, converted).survivor.id, 'a');
  });

  it('otherwise prefers the record with more history', () => {
    // A merge protects the timeline somebody actually worked.
    const worked = lead({ id: 'a', activityCount: 7 });
    const bare = lead({ id: 'b', activityCount: 1, createdAt: '2025-01-01T00:00:00.000Z' });
    const result = suggestSurvivor(bare, worked);
    assert.equal(result.survivor.id, 'a');
    assert.match(result.because, /history/i);
  });

  it('falls back to the older record', () => {
    const older = lead({ id: 'a', createdAt: '2025-01-01T00:00:00.000Z' });
    const newer = lead({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(suggestSurvivor(newer, older).survivor.id, 'a');
    assert.match(suggestSurvivor(newer, older).because, /older/i);
  });

  it('is stable whichever order it is given', () => {
    const a = lead({ id: 'a', activityCount: 3 });
    const b = lead({ id: 'b', activityCount: 9 });
    assert.equal(suggestSurvivor(a, b).survivor.id, suggestSurvivor(b, a).survivor.id);
  });

  it('always explains itself', () => {
    const result = suggestSurvivor(lead({ id: 'a' }), lead({ id: 'b' }));
    assert.ok(result.because.length > 10);
  });
});

describe('merge input', () => {
  const valid = { survivorId: 'lead-1234abcd', duplicateId: 'lead-5678efgh', reason: 'Same person' };

  it('requires a reason', () => {
    assert.equal(mergeLeadsSchema.safeParse({ ...valid, reason: '' }).success, false);
    assert.equal(mergeLeadsSchema.safeParse({ ...valid, reason: 'ok' }).success, false);
  });

  it('accepts a reasoned merge', () => {
    assert.ok(mergeLeadsSchema.safeParse(valid).success);
  });
});
