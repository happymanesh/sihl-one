import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * End-to-end checks against a running API.
 *
 * These are deliberately black-box HTTP calls rather than Nest testing-module
 * tests: the things being asserted — that a scoped user gets a 404 rather than
 * a 403, that an unauthenticated caller gets 401 — are properties of the whole
 * request pipeline (guards, filters, interceptors) and a testing module that
 * skips a guard would assert nothing useful.
 *
 * Requires the API and a seeded database:
 *   npm run db:seed -w @sihl-one/api && npm run start -w @sihl-one/api
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Sihl@One2026!';

interface Tokens {
  accessToken: string;
}

/**
 * Signs in, backing off if the login throttle trips.
 *
 * /auth/login is deliberately limited to 5 attempts per minute per IP, and this
 * suite needs four accounts — so a run that follows another run, or a developer
 * who just tested the login form, will hit it. The right response is for the
 * test to wait, not for the product to weaken a control that exists to stop
 * credential stuffing.
 */
async function login(identifier: string, attempt = 1): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });

  if (response.status === 429 && attempt <= 3) {
    const waitMs = 61_000;
    console.log(`  login throttled for ${identifier}; waiting ${waitMs / 1000}s (attempt ${attempt})`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return login(identifier, attempt + 1);
  }

  assert.equal(response.status, 200, `login failed for ${identifier} (HTTP ${response.status})`);
  const body = (await response.json()) as { tokens: Tokens };
  return body.tokens.accessToken;
}

/** A deliberately failing sign-in, retried past the throttle so the assertion
 *  measures the auth response rather than the rate limiter. */
async function failedLogin(
  identifier: string,
  password: string,
  attempt = 1,
): Promise<{ status: number; detail: string }> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });

  if (response.status === 429 && attempt <= 3) {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    return failedLogin(identifier, password, attempt + 1);
  }

  const body = (await response.json()) as { detail?: string };
  return { status: response.status, detail: body.detail ?? '' };
}

/** A syntactically valid PAN: five letters, four digits, one letter. */
function makePan(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pick = (): string => letters[Math.floor(Math.random() * letters.length)]!;
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${pick()}${pick()}${pick()}${pick()}${pick()}${digits}${pick()}`;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

let adminToken: string;
let managerToken: string;
let execToken: string;
let managementToken: string;

before(async () => {
  const health = await fetch(`${BASE.replace('/api/v1', '')}/health/ready`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API is not reachable at ${BASE}. Start it before running the e2e suite.`);
  }
  adminToken = await login('admin@sihl.in');
  managerToken = await login('salesmanager@sihl.in');
  execToken = await login('rahul.mehta@sihl.in');
  managementToken = await login('md@sihl.in');
});

describe('authentication', () => {
  it('rejects an anonymous request with 401', async () => {
    const response = await fetch(`${BASE}/leads`);
    assert.equal(response.status, 401);
  });

  it('rejects a malformed token with 401', async () => {
    const response = await fetch(`${BASE}/leads`, { headers: authed('not-a-real-token') });
    assert.equal(response.status, 401);
  });

  it('returns an identical message for a wrong password and an unknown account', async () => {
    // Account enumeration guard: for a broker, a login form that confirms who
    // holds an account is itself a data leak.
    //
    // Both attempts go through failedLogin(), which waits out the 5-per-minute
    // login throttle rather than asking the product to relax it for tests.
    const unknown = await failedLogin('nobody@nowhere.in', 'Whatever123!');
    const wrongPassword = await failedLogin('admin@sihl.in', 'DefinitelyWrong123!');

    assert.equal(unknown.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.equal(unknown.detail, wrongPassword.detail);
  });

  it('returns the signed-in user with resolved permissions', async () => {
    const response = await fetch(`${BASE}/auth/me`, { headers: authed(execToken) });
    assert.equal(response.status, 200);
    const user = (await response.json()) as { dataScope: string; permissions: string[] };
    assert.equal(user.dataScope, 'SELF');
    assert.ok(user.permissions.includes('lead:read'));
    assert.equal(user.permissions.includes('lead:assign'), false);
  });
});

describe('lead visibility (ABAC)', () => {
  it('narrows the visible set as scope narrows', async () => {
    const count = async (token: string): Promise<number> => {
      const response = await fetch(`${BASE}/leads?pageSize=1`, { headers: authed(token) });
      const body = (await response.json()) as { total: number };
      return body.total;
    };

    const [all, team, self] = await Promise.all([
      count(adminToken),
      count(managerToken),
      count(execToken),
    ]);

    assert.ok(all >= team, 'unrestricted scope must see at least what a team scope sees');
    assert.ok(team > self, 'a manager must see more than a single executive');
    assert.ok(self > 0, 'the seeded executive should own some leads');
  });

  it('returns 404, not 403, for a lead outside the callers scope', async () => {
    // 403 would confirm the record exists. 404 does not.
    const listed = await fetch(`${BASE}/leads?pageSize=50`, { headers: authed(managerToken) });
    const body = (await listed.json()) as {
      items: Array<{ id: string; owner: { fullName: string } | null }>;
    };
    const otherOwned = body.items.find(
      (lead) => lead.owner && lead.owner.fullName !== 'Rahul Mehta',
    );
    assert.ok(otherOwned, 'expected a lead owned by someone other than the test executive');

    const response = await fetch(`${BASE}/leads/${otherOwned.id}`, { headers: authed(execToken) });
    assert.equal(response.status, 404);
  });

  /**
   * Regression: ABAC must hold on write paths, not just reads.
   *
   * A decorator bug once bound the request body to parameter 0 — the
   * `@CurrentUser()` slot — so write handlers received the payload in place of
   * the principal. `user.dataScope` became undefined, the scope filter degraded
   * to `{ ownerId: undefined }`, and Prisma treats undefined as "no condition".
   * Reads stayed correctly locked down while writes were wide open, which is
   * exactly the shape of bug a read-only test suite never catches.
   */
  it('blocks writes to an out-of-scope lead, not just reads', async () => {
    const listed = await fetch(`${BASE}/leads?pageSize=50`, { headers: authed(managerToken) });
    const body = (await listed.json()) as {
      items: Array<{ id: string; status: string; owner: { fullName: string } | null }>;
    };
    const target = body.items.find(
      (lead) =>
        lead.owner &&
        lead.owner.fullName !== 'Rahul Mehta' &&
        ['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.status),
    );
    assert.ok(target, 'expected an open lead owned by another executive');

    const read = await fetch(`${BASE}/leads/${target.id}`, { headers: authed(execToken) });
    assert.equal(read.status, 404, 'read of an out-of-scope lead must 404');

    const write = await fetch(`${BASE}/leads/${target.id}/status`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({ status: 'DISQUALIFIED', note: 'scope bypass regression probe' }),
    });
    assert.equal(write.status, 404, 'write to an out-of-scope lead must 404, not succeed');

    // Prove nothing changed, rather than trusting the status code alone.
    const after = await fetch(`${BASE}/leads/${target.id}`, { headers: authed(managerToken) });
    const unchanged = (await after.json()) as { status: string };
    assert.equal(unchanged.status, target.status, 'the lead must be untouched');
  });

  it('masks contact details in list responses', async () => {
    const response = await fetch(`${BASE}/leads?pageSize=5`, { headers: authed(adminToken) });
    const body = (await response.json()) as { items: Array<{ mobileMasked: string }> };
    for (const lead of body.items) {
      assert.match(lead.mobileMasked, /^•+\d{4}$/, 'list mobiles must be masked');
    }
  });
});

describe('lead permissions (RBAC)', () => {
  it('refuses lead creation to a read-only management user', async () => {
    const response = await fetch(`${BASE}/leads`, {
      method: 'POST',
      headers: authed(managementToken),
      body: JSON.stringify({ firstName: 'Test', mobile: '9812345670', source: 'WEBSITE' }),
    });
    assert.equal(response.status, 403);

    const problem = (await response.json()) as { detail: string };
    // The message names the missing permission so support can act on it.
    assert.match(problem.detail, /lead:create/);
  });

  it('refuses assignment to a self-scoped executive', async () => {
    const response = await fetch(`${BASE}/leads/some-lead-id/assign`, {
      method: 'POST',
      headers: authed(execToken),
      body: JSON.stringify({ ownerId: 'someone' }),
    });
    assert.equal(response.status, 403);
  });
});

describe('lead lifecycle', () => {
  let createdId: string;
  const mobile = `9${String(Date.now()).slice(-9)}`;

  it('creates a lead and scores it', async () => {
    const response = await fetch(`${BASE}/leads`, {
      method: 'POST',
      headers: authed(managerToken),
      body: JSON.stringify({
        firstName: 'E2E',
        lastName: 'Prospect',
        mobile,
        email: 'e2e.prospect@example.com',
        source: 'REFERRAL',
        productInterest: ['EQUITY', 'DERIVATIVES'],
        priority: 'HIGH',
        estimatedValue: 500000,
      }),
    });
    assert.equal(response.status, 201);

    const lead = (await response.json()) as { id: string; score: number; status: string };
    createdId = lead.id;
    assert.equal(lead.status, 'NEW');
    assert.ok(lead.score > 0, 'a new lead must be scored on creation');
  });

  it('rejects a duplicate open lead on the same mobile', async () => {
    const response = await fetch(`${BASE}/leads`, {
      method: 'POST',
      headers: authed(managerToken),
      body: JSON.stringify({ firstName: 'Duplicate', mobile, source: 'WEBSITE' }),
    });
    assert.equal(response.status, 400);
    const problem = (await response.json()) as { detail: string };
    assert.match(problem.detail, /already exists/i);
    // The date is the point of the message: it tells the rep whether they are
    // colliding with a colleague's live lead or with something captured months
    // ago. `04-Sep-26 15:35`, in IST.
    assert.match(problem.detail, /added on : \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}/);
    // And who holds it, so the rep knows whether to hand off or pick it up.
    assert.match(problem.detail, /assigned to .+|not yet assigned to anyone/);
  });

  it('refuses an invalid status transition', async () => {
    // NEW → CONVERTED skips qualification and must be impossible.
    const response = await fetch(`${BASE}/leads/${createdId}/status`, {
      method: 'POST',
      headers: authed(managerToken),
      body: JSON.stringify({ status: 'CONVERTED' }),
    });
    assert.equal(response.status, 400);
  });

  it('requires a reason when marking a lead lost', async () => {
    const response = await fetch(`${BASE}/leads/${createdId}/status`, {
      method: 'POST',
      headers: authed(managerToken),
      body: JSON.stringify({ status: 'LOST' }),
    });
    assert.equal(response.status, 400);
  });

  it('walks the happy path and logs each transition', async () => {
    for (const status of ['CONTACTED', 'QUALIFIED']) {
      const response = await fetch(`${BASE}/leads/${createdId}/status`, {
        method: 'POST',
        headers: authed(managerToken),
        body: JSON.stringify({ status, note: `Moved to ${status} by the e2e suite` }),
      });
      assert.equal(response.status, 201, `transition to ${status} failed`);
    }

    const detail = await fetch(`${BASE}/leads/${createdId}`, { headers: authed(managerToken) });
    const lead = (await detail.json()) as {
      status: string;
      statusHistory: unknown[];
      allowedTransitions: string[];
    };
    assert.equal(lead.status, 'QUALIFIED');
    assert.ok(lead.statusHistory.length >= 3, 'every transition must be recorded');
    assert.ok(lead.allowedTransitions.includes('CONVERTED'));
  });

  it('converts a qualified lead into a customer', async () => {
    const pan = makePan();
    const response = await fetch(`${BASE}/leads/${createdId}/convert`, {
      method: 'POST',
      headers: authed(managerToken),
      body: JSON.stringify({ pan, email: 'e2e.prospect@example.com' }),
    });
    assert.equal(response.status, 201);

    const result = (await response.json()) as { customerId: string; customerReference: string };
    assert.match(result.customerReference, /^CU-\d{4}-\d{6}$/);

    const customer = await fetch(`${BASE}/customers/${result.customerId}`, {
      headers: authed(managerToken),
    });
    assert.equal(customer.status, 200);

    const view = (await customer.json()) as {
      acquisition: { leadId: string | null };
      onboarding: { onboardingStage: string };
    };
    // The customer must remember where it came from — that link is what makes
    // campaign ROI computable at all.
    assert.equal(view.acquisition.leadId, createdId);
    assert.equal(view.onboarding.onboardingStage, 'LEAD');
  });

  it('makes a converted lead read-only', async () => {
    const response = await fetch(`${BASE}/leads/${createdId}`, {
      method: 'PATCH',
      headers: authed(managerToken),
      body: JSON.stringify({ city: 'Should not apply' }),
    });
    assert.equal(response.status, 400);
  });
});

describe('public lead capture', () => {
  it('accepts an enquiry without a token and records consent', async () => {
    const response = await fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Anonymous',
        mobile: `9${String(Date.now() + 1).slice(-9)}`,
        source: 'WEBSITE',
        consentToContact: true,
      }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { reference: string };
    assert.match(body.reference, /^LD-\d{4}-\d{6}$/);
  });

  it('refuses an enquiry without consent', async () => {
    const response = await fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'No Consent',
        mobile: `9${String(Date.now() + 2).slice(-9)}`,
        consentToContact: false,
      }),
    });
    assert.equal(response.status, 400);
  });

  it('rejects an invalid mobile number', async () => {
    const response = await fetch(`${BASE}/leads/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Bad', mobile: '12345', consentToContact: true }),
    });
    assert.equal(response.status, 400);
    const problem = (await response.json()) as { errors?: Record<string, string[]> };
    assert.ok(problem.errors?.mobile, 'validation errors must be keyed by field');
  });
});

after(() => {
  // Leaves its data behind on purpose: the records are useful when a failure
  // needs investigating, and the suite runs against a disposable seeded
  // database rather than anything shared.
});
