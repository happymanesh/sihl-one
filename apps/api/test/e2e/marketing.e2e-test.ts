import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * Partners, campaigns and the audit trail, black-box over HTTP.
 *
 * The properties worth asserting at this level are the ones a unit test cannot
 * see: that the audit trail refuses a write path, that a campaign code collision
 * is reported usefully rather than as a database error, and that attribution
 * actually links a captured lead to its campaign — which is the whole point of
 * the campaign module and was silently broken until it was tested here.
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

const send = (path: string, token: string, method: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

let adminToken = '';
let execToken = '';

/**
 * Campaigns this suite creates, archived on the way out.
 *
 * Without this, every run leaves two more "E2E test campaign" rows in whatever
 * database it ran against — which in development is the same one the demo is
 * given from. Archiving rather than deleting matches the product: a campaign is
 * a spend record, and there is deliberately no delete path.
 */
const createdCampaigns: string[] = [];

after(async () => {
  for (const id of createdCampaigns) {
    await send(`/campaigns/${id}/status`, adminToken, 'PATCH', { status: 'ARCHIVED' });
  }
});

before(async () => {
  adminToken = await login('admin@sihl.in');
  execToken = await login('rahul.mehta@sihl.in');
});

describe('partners directory', () => {
  it('lists partners for staff who hold partner:read', async () => {
    const response = await get('/partners', adminToken);
    assert.equal(response.status, 200);

    const body = (await response.json()) as { items: Array<{ id: string; name: string }> };
    assert.ok(body.items.length > 0);
  });

  it('refuses a sales executive who does not hold partner:read', async () => {
    assert.equal((await get('/partners', execToken)).status, 403);
  });

  it('never returns an unmasked mobile on the 360 view', async () => {
    const list = (await (await get('/partners', adminToken)).json()) as {
      items: Array<{ id: string }>;
    };
    const detail = (await (await get(`/partners/${list.items[0]!.id}`, adminToken)).json()) as {
      profile: { mobileMasked: string } & Record<string, unknown>;
    };

    // Only the last four digits survive; the rest are masked, and there is no
    // raw `mobile` key for a careless client to read instead.
    assert.equal(/^\d{10}$/.test(detail.profile.mobileMasked), false, detail.profile.mobileMasked);
    assert.match(detail.profile.mobileMasked, /\d{4}$/);
    assert.equal('mobile' in detail.profile, false, 'the raw mobile must not be serialised');
  });

  it('labels every earnings figure as an estimate', async () => {
    const list = (await (await get('/partners', adminToken)).json()) as {
      items: Array<{ id: string }>;
    };
    const detail = (await (await get(`/partners/${list.items[0]!.id}`, adminToken)).json()) as {
      estimatedEarnings: { basis: string };
    };

    // ADR-0002: SIHL ONE is not the system of record for money.
    assert.match(detail.estimatedEarnings.basis, /estimate|not settled|back office/i);
  });
});

describe('campaigns', () => {
  let campaignId = '';
  const code = `e2e-${Date.now()}`;

  it('creates a campaign', async () => {
    const response = await send('/campaigns', adminToken, 'POST', {
      name: 'E2E test campaign',
      code,
      channels: ['EMAIL'],
      budget: 100_000,
    });
    assert.equal(response.status, 201);

    const body = (await response.json()) as { id: string; code: string };
    campaignId = body.id;
    createdCampaigns.push(body.id);
    assert.equal(body.code, code);
  });

  it('explains a duplicate code by naming the campaign that holds it', async () => {
    const response = await send('/campaigns', adminToken, 'POST', {
      name: 'Another one',
      code,
      channels: ['EMAIL'],
    });
    assert.equal(response.status, 409);

    const problem = (await response.json()) as { detail: string };
    // The code cannot be changed later, so a generic conflict is not enough.
    assert.match(problem.detail, /E2E test campaign/);
  });

  it('returns null cost metrics rather than zero when spend is unrecorded', async () => {
    const detail = (await (await get(`/campaigns/${campaignId}`, adminToken)).json()) as {
      performance: { costPerLead: number | null; attributedValuePerRupee: number | null };
    };

    assert.equal(detail.performance.costPerLead, null);
    assert.equal(detail.performance.attributedValuePerRupee, null);
  });

  it('never describes attributed business as a return', async () => {
    const detail = (await (await get(`/campaigns/${campaignId}`, adminToken)).json()) as {
      performance: { verdict: string };
    };
    // A lead's estimated value is the size of the client, not brokerage.
    assert.equal(/return on spend|roi/i.test(detail.performance.verdict), false);
  });

  it('issues a tracking URL carrying the campaign code', async () => {
    const detail = (await (await get(`/campaigns/${campaignId}`, adminToken)).json()) as {
      trackingUrl: string;
    };
    assert.equal(new URL(detail.trackingUrl).searchParams.get('utm_campaign'), code);
  });

  it('walks the lifecycle and then refuses to reopen', async () => {
    assert.equal(
      (await send(`/campaigns/${campaignId}/status`, adminToken, 'PATCH', { status: 'RUNNING' }))
        .status,
      200,
    );
    assert.equal(
      (await send(`/campaigns/${campaignId}/status`, adminToken, 'PATCH', { status: 'COMPLETED' }))
        .status,
      200,
    );

    // Spend and attributed leads have already been reported against it.
    const reopen = await send(`/campaigns/${campaignId}/status`, adminToken, 'PATCH', {
      status: 'RUNNING',
    });
    assert.equal(reopen.status, 400);
  });

  it('attributes a captured lead to its campaign, case-insensitively', async () => {
    // The property the whole module rests on. Storing utm_campaign as a string
    // without resolving it leaves every campaign report reading zero while the
    // leads sit in the database with the right code on them.
    const fresh = `attrib-${Date.now()}`;
    const created = (await (
      await send('/campaigns', adminToken, 'POST', {
        name: 'Attribution check',
        code: fresh,
        channels: ['SEARCH'],
      })
    ).json()) as { id: string };
    createdCampaigns.push(created.id);

    const mobile = `98${String(Date.now()).slice(-8)}`;
    const capture = await fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Attribution',
        lastName: 'Probe',
        mobile,
        source: 'WEBSITE',
        productInterest: ['EQUITY'],
        consentToContact: true,
        attribution: { utmCampaign: fresh.toUpperCase() },
      }),
    });
    assert.equal(capture.status, 201, `capture failed (HTTP ${capture.status})`);

    const detail = (await (await get(`/campaigns/${created.id}`, adminToken)).json()) as {
      leads: number;
    };
    assert.equal(detail.leads, 1, 'the captured lead should be attributed to the campaign');
  });

  it('refuses a campaign read to someone without campaign:read', async () => {
    assert.equal((await get('/campaigns', execToken)).status, 403);
  });
});

describe('audit trail', () => {
  it('reads back entries with a plain-language summary', async () => {
    const response = await get('/audit?pageSize=5', adminToken);
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      items: Array<{ summary: string; action: string; isSecurityRelevant: boolean }>;
    };
    assert.ok(body.items.length > 0);
    for (const entry of body.items) {
      assert.ok(entry.summary.length > 10, entry.summary);
      assert.ok(entry.summary.endsWith('.'));
    }
  });

  it('records the campaign work this suite just did', async () => {
    const body = (await (
      await get('/audit?resource=campaign&action=CREATE&pageSize=5', adminToken)
    ).json()) as { items: Array<{ resource: string; action: string }> };

    assert.ok(body.items.length > 0, 'campaign creation must be audited');
    assert.equal(body.items[0]!.action, 'CREATE');
  });

  it('filters to security-relevant entries', async () => {
    const body = (await (await get('/audit?securityOnly=true&pageSize=20', adminToken)).json()) as {
      items: Array<{ isSecurityRelevant: boolean }>;
    };
    for (const entry of body.items) {
      assert.equal(entry.isSecurityRelevant, true);
    }
  });

  it('exposes no write path at all', async () => {
    // Append-only is a property of the deployment, not a convention. There is
    // no route to create, edit or delete an entry.
    for (const [method, path] of [
      ['POST', '/audit'],
      ['PATCH', '/audit/some-id'],
      ['PUT', '/audit/some-id'],
      ['DELETE', '/audit/some-id'],
    ] as const) {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: method === 'DELETE' ? undefined : '{}',
      });
      assert.ok(
        response.status === 404 || response.status === 405,
        `${method} ${path} returned ${response.status} — a write path exists`,
      );
    }
  });

  it('refuses a sales executive', async () => {
    assert.equal((await get('/audit', execToken)).status, 403);
  });

  it('summarises the last seven days', async () => {
    const summary = (await (await get('/audit/summary?days=7', adminToken)).json()) as {
      total: number;
      failedLogins: number;
      distinctActors: number;
    };
    assert.ok(summary.total >= 0);
    assert.ok(summary.distinctActors >= 1);
  });
});

describe('coded capture — partner referrals and event QR', () => {
  let referralCode = '';
  let eventId = '';
  const eventCode = `e2e-expo-${Date.now()}`;

  const capture = (body: Record<string, unknown>) =>
    fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Coded',
        lastName: 'Capture',
        source: 'WEBSITE',
        productInterest: ['EQUITY'],
        consentToContact: true,
        ...body,
      }),
    });

  before(async () => {
    const partnerToken = await login('partner@trinetrafin.in');
    const link = (await (await get('/partners/me/referral-link', partnerToken)).json()) as {
      code: string;
      url: string;
    };
    referralCode = link.code;
    assert.match(link.url, /\/join\/p\//);

    const created = (await (
      await send('/events', adminToken, 'POST', {
        name: 'E2E expo',
        code: eventCode,
        startsAt: new Date().toISOString(),
      })
    ).json()) as { id: string };
    eventId = created.id;
  });

  it('issues a code free of characters people mishear', () => {
    // Read down a phone line and copied off printed cards.
    for (const character of ['0', 'O', '1', 'I', 'L']) {
      assert.equal(referralCode.includes(character), false, `contains ${character}`);
    }
  });

  it('returns the same referral link every time', async () => {
    const partnerToken = await login('partner@trinetrafin.in');
    const again = (await (await get('/partners/me/referral-link', partnerToken)).json()) as {
      code: string;
    };
    // A printed card that silently stops working is worse than no card.
    assert.equal(again.code, referralCode);
  });

  it('resolves a referral code publicly without naming anything else', async () => {
    const response = await fetch(`${BASE}/events/capture-context/p/${referralCode}`);
    assert.equal(response.status, 200);

    const context = (await response.json()) as Record<string, unknown>;
    assert.equal(context.attributedTo, 'Trinetra Financial Services');
    // Nothing about the partner beyond their name should leak to the public.
    const serialised = JSON.stringify(context);
    assert.equal(/@|commission|pan|gstin/i.test(serialised), false, serialised);
  });

  it('404s an unknown code rather than silently collecting an orphan lead', async () => {
    assert.equal((await fetch(`${BASE}/events/capture-context/p/ZZZZZZZZ`)).status, 404);
  });

  it('attributes a capture to the partner, case-insensitively', async () => {
    const mobile = `98${String(Date.now()).slice(-8)}`;
    const response = await capture({ mobile, partnerCode: referralCode.toLowerCase() });
    assert.equal(response.status, 201);

    const partnerToken = await login('partner@trinetrafin.in');
    const mine = (await (await get(`/leads?q=${mobile}`, partnerToken)).json()) as {
      total: number;
      items: Array<{ source: string }>;
    };
    // Scoped to the partner *because* of the code, with nobody logged in.
    assert.equal(mine.total, 1);
    assert.equal(mine.items[0]?.source, 'PARTNER');
  });

  it('ignores a client-supplied partnerId', async () => {
    // The endpoint is unauthenticated. If an id in the body were honoured,
    // anyone could attribute someone else's business to themselves.
    const mobile = `98${String(Date.now() + 1).slice(-8)}`;
    const response = await capture({ mobile, partnerId: 'cmskpy7v1000ihstsc4mgxqt0' });
    assert.equal(response.status, 201);

    const partnerToken = await login('partner@trinetrafin.in');
    const mine = (await (await get(`/leads?q=${mobile}`, partnerToken)).json()) as { total: number };
    assert.equal(mine.total, 0, 'a raw partnerId must not attribute the lead');
  });

  it('refuses event scans until the event is running', async () => {
    const context = (await (
      await fetch(`${BASE}/events/capture-context/e/${eventCode}`)
    ).json()) as { acceptingSubmissions: boolean; closedReason: string };

    assert.equal(context.acceptingSubmissions, false);
    assert.match(context.closedReason, /not started/i);

    // A capture still records the person — losing a real visitor is worse —
    // but it must not be attributed to an event that is not open.
    const mobile = `97${String(Date.now()).slice(-8)}`;
    assert.equal((await capture({ mobile, eventCode })).status, 201);

    const detail = (await (await get(`/events/${eventId}`, adminToken)).json()) as { leads: number };
    assert.equal(detail.leads, 0);
  });

  it('captures against a running event and routes it to the owner', async () => {
    await send(`/events/${eventId}/status`, adminToken, 'PATCH', { status: 'RUNNING' });

    const mobile = `97${String(Date.now() + 2).slice(-8)}`;
    assert.equal((await capture({ mobile, eventCode: eventCode.toUpperCase() })).status, 201);

    const detail = (await (await get(`/events/${eventId}`, adminToken)).json()) as {
      leads: number;
      uncontacted: number;
    };
    assert.equal(detail.leads, 1);
    assert.equal(detail.uncontacted, 1);
  });

  it('stops accepting scans once the event closes', async () => {
    await send(`/events/${eventId}/status`, adminToken, 'PATCH', { status: 'COMPLETED' });

    const context = (await (
      await fetch(`${BASE}/events/capture-context/e/${eventCode}`)
    ).json()) as { acceptingSubmissions: boolean; closedReason: string };
    assert.equal(context.acceptingSubmissions, false);
    assert.match(context.closedReason, /ended/i);

    // A stale QR on a poster nobody took down must not inflate a closed
    // event's report months later.
    const mobile = `97${String(Date.now() + 3).slice(-8)}`;
    await capture({ mobile, eventCode });

    const detail = (await (await get(`/events/${eventId}`, adminToken)).json()) as { leads: number };
    assert.equal(detail.leads, 1);
  });

  it('refuses an event code that collides with a partner referral code', async () => {
    const response = await send('/events', adminToken, 'POST', {
      name: 'Collision',
      code: referralCode.toLowerCase(),
      startsAt: new Date().toISOString(),
    });
    assert.equal(response.status, 409);
  });
});
