import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * End-to-end checks for Phase 2: field visits, documents and the partner portal.
 *
 * Requires a running, seeded API. See `leads.e2e-test.ts` for the rationale on
 * testing through HTTP rather than a Nest testing module.
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

  assert.equal(response.status, 200, `login failed for ${identifier} (${response.status})`);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return body.tokens.accessToken;
}

const authed = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

/** Structurally valid JPEG — the API checks magic numbers, not extensions. */
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

async function uploadPhoto(token: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'selfie.jpg');

  const response = await fetch(`${BASE}/files?purpose=VISIT_PHOTO`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(response.status, 201, 'photo upload failed');

  const body = (await response.json()) as { storageKey: string };
  return body.storageKey;
}

let execToken: string;
let otherExecToken: string;
let partnerToken: string;
let adminToken: string;
let leadId: string;

before(async () => {
  execToken = await login('rahul.mehta@sihl.in');
  otherExecToken = await login('sneha.patel@sihl.in');
  partnerToken = await login('partner@trinetrafin.in');
  adminToken = await login('admin@sihl.in');

  const leads = await fetch(`${BASE}/leads?pageSize=1&status=CONTACTED`, {
    headers: authed(execToken),
  });
  const body = (await leads.json()) as { items: Array<{ id: string }> };
  assert.ok(body.items[0], 'expected at least one contacted lead in the seed');
  leadId = body.items[0].id;
});

describe('file upload hardening', () => {
  it('accepts a genuine JPEG', async () => {
    const key = await uploadPhoto(execToken);
    assert.match(key, /^visits\/photos\/.+\.jpg$/);
  });

  it('rejects HTML disguised as a JPEG', async () => {
    // The declared type is attacker-controlled; the bytes are what count.
    const form = new FormData();
    form.append(
      'file',
      new Blob(['<script>alert(1)</script>'], { type: 'image/jpeg' }),
      'evil.jpg',
    );

    const response = await fetch(`${BASE}/files?purpose=VISIT_PHOTO`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${execToken}` },
      body: form,
    });

    assert.equal(response.status, 400);
    const problem = (await response.json()) as { title: string };
    assert.match(problem.title, /does not match its type/);
  });

  it('rejects a type outside the allow-list', async () => {
    const form = new FormData();
    form.append('file', new Blob(['<html></html>'], { type: 'text/html' }), 'page.html');

    const response = await fetch(`${BASE}/files?purpose=VISIT_PHOTO`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${execToken}` },
      body: form,
    });
    assert.equal(response.status, 400);
  });

  it('rejects an unknown upload purpose', async () => {
    const form = new FormData();
    form.append('file', new Blob([JPEG_BYTES], { type: 'image/jpeg' }), 'a.jpg');

    const response = await fetch(`${BASE}/files?purpose=../../etc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${execToken}` },
      body: form,
    });
    assert.equal(response.status, 400);
  });
});

describe('visit lifecycle', () => {
  let visitId: string;

  it('plans a visit against a lead in scope', async () => {
    const response = await fetch(`${BASE}/visits`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        entityType: 'LEAD',
        entityId: leadId,
        purpose: 'E2E documents collection',
      }),
    });
    assert.equal(response.status, 201);

    const visit = (await response.json()) as { id: string; status: string; reference: string };
    visitId = visit.id;
    assert.equal(visit.status, 'PLANNED');
    assert.match(visit.reference, /^VS-\d{4}-\d{6}$/);
  });

  it('refuses to check out before checking in', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}/check-out`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.0225,
        longitude: 72.5714,
        accuracy: 10,
        meetingNotes: 'Should not be accepted',
      }),
    });
    assert.equal(response.status, 400);
  });

  it('refuses a check-in without a photo', async () => {
    // The photograph is the evidence; without it this is just a self-report.
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({ latitude: 23.0225, longitude: 72.5714, accuracy: 10 }),
    });
    assert.equal(response.status, 400);

    const problem = (await response.json()) as { errors?: Record<string, string[]> };
    assert.ok(problem.errors?.photoKey);
  });

  it('refuses a check-in with a photo key that was never uploaded', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.0225,
        longitude: 72.5714,
        accuracy: 10,
        photoKey: 'visits/photos/fabricated.jpg',
      }),
    });
    assert.equal(response.status, 400);
  });

  it('refuses a location fix too imprecise to mean anything', async () => {
    const photoKey = await uploadPhoto(execToken);
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.0225,
        longitude: 72.5714,
        accuracy: 99_999,
        photoKey,
      }),
    });
    assert.equal(response.status, 400);
  });

  it('refuses a check-in by anyone other than the visit owner', async () => {
    // A check-in asserts that a specific person was physically somewhere.
    const photoKey = await uploadPhoto(otherExecToken);
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(otherExecToken),
      body: JSON.stringify({
        latitude: 23.0225,
        longitude: 72.5714,
        accuracy: 10,
        photoKey,
      }),
    });
    assert.equal(response.status, 404);
  });

  it('checks in with a real photo and a usable fix', async () => {
    const photoKey = await uploadPhoto(execToken);
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.0225,
        longitude: 72.5714,
        accuracy: 12,
        photoKey,
        address: 'Satellite, Ahmedabad',
      }),
    });
    assert.equal(response.status, 201);

    const visit = (await response.json()) as {
      status: string;
      checkIn: { quality: string; photoUrl: string | null };
    };
    assert.equal(visit.status, 'CHECKED_IN');
    assert.equal(visit.checkIn.quality, 'PRECISE');
    // The raw storage key is never returned — only a signed, expiring grant.
    assert.ok(visit.checkIn.photoUrl?.includes('token='));
  });

  it('refuses a second check-in', async () => {
    const photoKey = await uploadPhoto(execToken);
    const response = await fetch(`${BASE}/visits/${visitId}/check-in`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({ latitude: 23.02, longitude: 72.57, accuracy: 10, photoKey }),
    });
    assert.equal(response.status, 400);
  });

  it('requires meeting notes at check-out', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}/check-out`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({ latitude: 23.0226, longitude: 72.5715, accuracy: 15 }),
    });
    assert.equal(response.status, 400);
  });

  it('completes the visit and assesses the location evidence', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}/check-out`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.0226,
        longitude: 72.5715,
        accuracy: 15,
        meetingNotes: 'Collected PAN and bank proof.',
        outcome: 'Documents collected',
      }),
    });
    assert.equal(response.status, 201);

    const visit = (await response.json()) as {
      status: string;
      durationMinutes: number;
      integrity: { driftMetres: number | null; requiresReview: boolean };
    };
    assert.equal(visit.status, 'COMPLETED');
    assert.ok(visit.integrity.driftMetres !== null && visit.integrity.driftMetres < 100);
  });

  it('writes the visit on to the lead timeline', async () => {
    // The point of the module: a visit is part of the relationship history, not
    // a separate silo.
    const response = await fetch(`${BASE}/leads/${leadId}`, { headers: authed(execToken) });
    const lead = (await response.json()) as { timeline: Array<{ type: string }> };
    assert.ok(lead.timeline.some((entry) => entry.type === 'VISIT'));
  });

  it('treats a completed visit as immutable', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}/check-out`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({
        latitude: 23.02,
        longitude: 72.57,
        accuracy: 10,
        meetingNotes: 'Trying again',
      }),
    });
    assert.equal(response.status, 400);
  });

  it('hides another executive’s visit', async () => {
    const response = await fetch(`${BASE}/visits/${visitId}`, {
      headers: authed(otherExecToken),
    });
    assert.equal(response.status, 404);
  });
});

describe('partner portal', () => {
  it('returns the signed-in partner’s own 360', async () => {
    const response = await fetch(`${BASE}/partners/me`, { headers: authed(partnerToken) });
    assert.equal(response.status, 200);

    const partner = (await response.json()) as {
      profile: { name: string };
      business: { leadsSourced: number };
      estimatedEarnings: { basis: string };
    };
    assert.ok(partner.profile.name.length > 0);
    assert.ok(partner.business.leadsSourced > 0);
    // Money must always be labelled as an estimate, never as settled brokerage.
    assert.match(partner.estimatedEarnings.basis, /Not settled brokerage/i);
  });

  it('refuses a partner access to another partner’s record', async () => {
    const list = await fetch(`${BASE}/partners?pageSize=50`, { headers: authed(adminToken) });
    const body = (await list.json()) as { items: Array<{ id: string }> };

    const mine = await fetch(`${BASE}/partners/me`, { headers: authed(partnerToken) });
    const { profile } = (await mine.json()) as { profile: { id: string } };

    const other = body.items.find((partner) => partner.id !== profile.id);
    if (!other) return; // Only one partner seeded; nothing to assert against.

    const response = await fetch(`${BASE}/partners/${other.id}`, {
      headers: authed(partnerToken),
    });
    assert.equal(response.status, 403);
  });

  it('scopes a partner’s lead list to business they sourced', async () => {
    const [partnerLeads, allLeads] = await Promise.all([
      fetch(`${BASE}/leads?pageSize=1`, { headers: authed(partnerToken) }),
      fetch(`${BASE}/leads?pageSize=1`, { headers: authed(adminToken) }),
    ]);

    const partnerBody = (await partnerLeads.json()) as { total: number };
    const allBody = (await allLeads.json()) as { total: number };

    assert.ok(partnerBody.total > 0, 'the seeded partner should have sourced leads');
    assert.ok(partnerBody.total < allBody.total, 'a partner must not see the whole book');
  });
});

describe('outbox relay', () => {
  it('reports its health to an administrator', async () => {
    const response = await fetch(`${BASE}/outbox/stats`, { headers: authed(adminToken) });
    assert.equal(response.status, 200);

    const stats = (await response.json()) as {
      enabled: boolean;
      pending: number;
      deadLettered: number;
    };
    assert.equal(typeof stats.pending, 'number');
    assert.equal(stats.deadLettered, 0, 'no event should have been dead-lettered');
  });

  it('is not readable by an ordinary user', async () => {
    const response = await fetch(`${BASE}/outbox/stats`, { headers: authed(execToken) });
    assert.equal(response.status, 403);
  });

  it('drains the events produced by this run', async () => {
    // The visit lifecycle above emitted visit.checked_in and visit.completed.
    const flush = await fetch(`${BASE}/outbox/flush`, {
      method: 'POST',
      headers: authed(adminToken),
    });
    assert.equal(flush.status, 201);

    const stats = await fetch(`${BASE}/outbox/stats`, { headers: authed(adminToken) });
    const body = (await stats.json()) as { pending: number; publishedSinceBoot: number };
    assert.equal(body.pending, 0, 'the relay should have drained the queue');
    assert.ok(body.publishedSinceBoot > 0);
  });
});
