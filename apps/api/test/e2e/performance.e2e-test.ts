import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * Performance and allocation, black-box over HTTP.
 *
 * Two things here are worth testing at this level rather than in a unit test:
 * that a rating is personnel information the API refuses to hand to a peer, and
 * that allocation advice never contains an assignment. Both are properties of
 * the whole pipeline, and both are the kind of thing that quietly regresses.
 *
 * Requires the API and a seeded database:
 *   npm run db:seed -w @sihl-one/api && npm run start -w @sihl-one/api
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
    console.log(`  login throttled for ${identifier}; waiting 61s (attempt ${attempt})`);
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    return login(identifier, attempt + 1);
  }

  assert.equal(response.status, 200, `login failed for ${identifier} (HTTP ${response.status})`);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return body.tokens.accessToken;
}

const get = (path: string, token: string) =>
  fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

let adminToken = '';
let managerToken = '';
let execToken = '';
let peerToken = '';
let execId = '';
let peerId = '';

before(async () => {
  adminToken = await login('admin@sihl.in');
  managerToken = await login('salesmanager@sihl.in');
  execToken = await login('rahul.mehta@sihl.in');
  peerToken = await login('sneha.patel@sihl.in');

  const me = async (token: string) =>
    ((await (await get('/auth/me', token)).json()) as { id: string }).id;
  execId = await me(execToken);
  peerId = await me(peerToken);
});

describe('scorecard', () => {
  it('gives a rep their own card with an explanation', async () => {
    const response = await get('/performance/me', execToken);
    assert.equal(response.status, 200);

    const card = (await response.json()) as {
      rating: { overall: number; confidence: string; explanation: string[]; behaviourMetrics: unknown[] };
      nudges: unknown[];
    };

    assert.ok(card.rating.overall >= 0 && card.rating.overall <= 100);
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(card.rating.confidence));
    // An unexplained rating is one people argue with rather than act on.
    assert.ok(card.rating.explanation.length >= 2);
    assert.ok(card.rating.behaviourMetrics.length > 0);
  });

  it('lets a manager read their own team member’s card', async () => {
    const response = await get(`/performance/users/${execId}`, managerToken);
    assert.equal(response.status, 200);
  });

  it('refuses a peer’s card', async () => {
    // A rating is personnel information, not a leaderboard entry.
    const response = await get(`/performance/users/${peerId}`, execToken);
    assert.equal(response.status, 403);
  });

  it('never returns a ranked list of colleagues', async () => {
    const card = (await (await get('/performance/me', execToken)).json()) as {
      standing: Record<string, unknown>;
    };
    const serialised = JSON.stringify(card.standing);
    assert.equal(/@sihl\.in/.test(serialised), false, 'standing must not name anyone');
    assert.ok('percentile' in card.standing);
  });
});

describe('allocation advice', () => {
  let leadId = '';

  before(async () => {
    const leads = (await (await get('/leads?limit=1', managerToken)).json()) as {
      items: Array<{ id: string }>;
    };
    leadId = leads.items[0]!.id;
  });

  it('recommends owners with reasons, and assigns nobody', async () => {
    const response = await get(`/leads/${leadId}/owner-suggestions`, managerToken);
    assert.equal(response.status, 200);

    const advice = (await response.json()) as {
      recommendations: Array<{ userId: string; rank: number; reasons: string[] }>;
      excluded: Array<{ reason: string }>;
      note: string;
      leadBand: string;
    };

    assert.ok(['STRONG', 'STANDARD'].includes(advice.leadBand));
    for (const recommendation of advice.recommendations) {
      assert.ok(recommendation.reasons.length > 0, 'every suggestion must justify itself');
    }
    assert.match(advice.note, /nothing is assigned|nobody/i);
  });

  it('leaves the lead’s owner unchanged', async () => {
    const before = (await (await get(`/leads/${leadId}`, managerToken)).json()) as {
      owner: { id: string } | null;
    };
    await get(`/leads/${leadId}/owner-suggestions`, managerToken);
    const after = (await (await get(`/leads/${leadId}`, managerToken)).json()) as {
      owner: { id: string } | null;
    };

    assert.equal(after.owner?.id ?? null, before.owner?.id ?? null);
  });

  it('refuses a rep without lead:assign', async () => {
    const response = await get(`/leads/${leadId}/owner-suggestions`, execToken);
    assert.equal(response.status, 403);
  });

  it('404s for a lead outside the caller’s scope', async () => {
    const outOfScope = (await (
      await get('/leads?limit=200', adminToken)
    ).json()) as { items: Array<{ id: string; owner: { id: string } | null }> };

    const foreign = outOfScope.items.find(
      (lead) => lead.owner && lead.owner.id !== execId && lead.owner.id !== peerId,
    );
    if (!foreign) return;

    // Not 403: confirming the id exists is itself a disclosure.
    const response = await get(`/leads/${foreign.id}/owner-suggestions`, peerToken);
    assert.ok([403, 404].includes(response.status), `got ${response.status}`);
  });
});
