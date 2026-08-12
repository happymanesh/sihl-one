import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * Duplicate detection and merging, black-box over HTTP.
 *
 * The properties worth this level: that a merge moves history rather than
 * stranding it, that a converted lead cannot be merged away, and that a lead
 * outside the caller's scope cannot be reached through the merge endpoint —
 * which is exactly the operation somebody would use to probe for one.
 *
 * Requires the API and a seeded database.
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Sihl@One2026!';

async function login(identifier: string, attempt = 1): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (response.status === 429 && attempt <= 3) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    return login(identifier, attempt + 1);
  }
  assert.equal(response.status, 200, `login failed for ${identifier}`);
  return ((await response.json()) as { tokens: { accessToken: string } }).tokens.accessToken;
}

const get = (path: string, token: string) =>
  fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

const send = (path: string, token: string, method: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

let adminToken = '';
let execToken = '';

let counter = 0;
/** Six digits, unique within a run, so mobiles stay valid and unused. */
const stamp = (): string => String((Date.now() + counter++) % 1_000_000).padStart(6, '0');

async function makeLead(token: string, over: Record<string, unknown>) {
  const response = await send('/leads', token, 'POST', {
    firstName: 'Dup',
    lastName: 'Probe',
    source: 'WEBSITE',
    productInterest: ['EQUITY'],
    ...over,
  });
  assert.equal(response.status, 201, `lead create failed (${response.status})`);
  return (await response.json()) as { id: string; reference: string };
}

before(async () => {
  adminToken = await login('admin@sihl.in');
  execToken = await login('rahul.mehta@sihl.in');
});

describe('detection', () => {
  it('groups leads that share an email', async () => {
    const s = stamp();
    const email = `dup.${s}@example.com`;
    await makeLead(adminToken, { mobile: `9871${s.slice(0, 6)}`, email });
    await makeLead(adminToken, { mobile: `9872${s.slice(0, 6)}`, email });

    const body = (await (await get('/duplicates?key=EMAIL', adminToken)).json()) as {
      items: Array<{ keyLabel: string; leads: Array<{ id: string }> }>;
    };
    const group = body.items.find(
      (entry) => entry.leads.length >= 2 && entry.keyLabel.includes('@'),
    );
    assert.ok(group, 'the pair should surface as a group');
  });

  it('never returns a raw identity key to the browser', async () => {
    // A duplicate queue that prints full mobile numbers is a nicely paginated
    // export of the customer book.
    const body = (await (await get('/duplicates', adminToken)).json()) as {
      items: Array<{ keyLabel: string; leads: Array<{ mobileMasked: string }> }>;
    };
    for (const group of body.items) {
      assert.match(group.keyLabel, /\*/, group.keyLabel);
      for (const lead of group.leads) assert.match(lead.mobileMasked, /\*|•/);
    }
  });
});

describe('merging', () => {
  it('moves history and closes the duplicate as a tombstone', async () => {
    const s = stamp();
    const email = `merge.${s}@example.com`;
    const survivor = await makeLead(adminToken, {
      mobile: `9873${s.slice(0, 6)}`,
      email,
      city: 'Ahmedabad',
    });
    const duplicate = await makeLead(adminToken, {
      mobile: `9874${s.slice(0, 6)}`,
      email,
      state: 'Gujarat',
      estimatedValue: 900_000,
    });

    await send('/activities', adminToken, 'POST', {
      entityType: 'LEAD',
      entityId: duplicate.id,
      type: 'CALL',
      direction: 'OUTBOUND',
      subject: 'Called about the enquiry',
    });

    const preview = (await (
      await get(
        `/duplicates/preview?survivorId=${survivor.id}&duplicateId=${duplicate.id}`,
        adminToken,
      )
    ).json()) as { preview: { gains: Array<{ field: string }> }; eligibility: { ok: boolean } };
    assert.equal(preview.eligibility.ok, true);
    assert.ok(preview.preview.gains.some((gain) => gain.field === 'state'));

    const merged = await send('/duplicates/merge', adminToken, 'POST', {
      survivorId: survivor.id,
      duplicateId: duplicate.id,
      reason: 'Same person, enquired twice',
    });
    assert.equal(merged.status, 201, `merge failed (${merged.status})`);

    const after = (await (await get(`/leads/${survivor.id}`, adminToken)).json()) as {
      state: string | null;
      city: string | null;
      activityCount: number;
    };
    // Gained what it lacked, kept what it had, and inherited the conversation.
    assert.equal(after.state, 'Gujarat');
    assert.equal(after.city, 'Ahmedabad');
    assert.ok(after.activityCount >= 2, `expected history to move, got ${after.activityCount}`);

    const tombstone = (await (await get(`/leads/${duplicate.id}`, adminToken)).json()) as {
      status: string;
      lostReason: string | null;
    };
    // Closed, not deleted: the record of that conversation still exists.
    assert.equal(tombstone.status, 'DISQUALIFIED');
    assert.equal(tombstone.lostReason, 'DUPLICATE');
  });

  it('requires a reason', async () => {
    const s = stamp();
    const email = `reason.${s}@example.com`;
    const a = await makeLead(adminToken, { mobile: `9875${s.slice(0, 6)}`, email });
    const b = await makeLead(adminToken, { mobile: `9876${s.slice(0, 6)}`, email });

    const response = await send('/duplicates/merge', adminToken, 'POST', {
      survivorId: a.id,
      duplicateId: b.id,
      reason: '',
    });
    assert.equal(response.status, 400);
  });

  it('refuses to merge a lead into itself', async () => {
    const s = stamp();
    const a = await makeLead(adminToken, {
      mobile: `9877${s.slice(0, 6)}`,
      email: `self.${s}@example.com`,
    });

    const response = await send('/duplicates/merge', adminToken, 'POST', {
      survivorId: a.id,
      duplicateId: a.id,
      reason: 'Same record',
    });
    assert.equal(response.status, 400);
  });

  it('refuses to merge away a converted lead', async () => {
    const s = stamp();
    const email = `conv.${s}@example.com`;
    const keeper = await makeLead(adminToken, { mobile: `9878${s.slice(0, 6)}`, email });
    const converted = await makeLead(adminToken, { mobile: `9879${s.slice(0, 6)}`, email });

    for (const status of ['CONTACTED', 'QUALIFIED']) {
      await send(`/leads/${converted.id}/status`, adminToken, 'POST', { status });
    }
    const convertResponse = await send(`/leads/${converted.id}/convert`, adminToken, 'POST', {
      pan: `DUPPZ${s.slice(0, 4)}Q`,
      email: `converted.${s}@example.com`,
    });
    assert.equal(convertResponse.status, 201, 'setup: conversion should succeed');

    // It has a customer behind it that may already carry a back-office client
    // code. Folding it away would orphan the account.
    const response = await send('/duplicates/merge', adminToken, 'POST', {
      survivorId: keeper.id,
      duplicateId: converted.id,
      reason: 'Trying to merge away a converted lead',
    });
    assert.equal(response.status, 400);
    const problem = (await response.json()) as { detail: string };
    assert.match(problem.detail, /converted/i);
  });

  it('404s a lead outside the scope rather than confirming it exists', async () => {
    const s = stamp();
    const mine = await makeLead(execToken, {
      mobile: `9880${s.slice(0, 6)}`,
      email: `scope.${s}@example.com`,
    });
    const theirs = await makeLead(adminToken, {
      mobile: `9881${s.slice(0, 6)}`,
      email: `scope2.${s}@example.com`,
    });

    const response = await send('/duplicates/merge', execToken, 'POST', {
      survivorId: mine.id,
      duplicateId: theirs.id,
      reason: 'Probing for a lead I cannot see',
    });
    assert.equal(response.status, 404, `expected 404, got ${response.status}`);
  });
});
