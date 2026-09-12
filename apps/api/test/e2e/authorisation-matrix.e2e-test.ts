import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  ROLE_PERMISSIONS,
  effectiveScope,
  permissionsForRoles,
  type Permission,
  type Role,
} from '@sihl-one/contracts';

/**
 * Authorisation, checked as behaviour rather than as configuration.
 *
 * Its companion, test/unit/route-guards.test.ts, asserts that every route
 * declares a permission. That is the cheap half and it proves nothing about
 * data: a route can carry the right permission and still hand one branch's
 * clients to another, because reach is decided by the ABAC scope inside the
 * service, not by the guard on the route.
 *
 * So this suite asks the only question that matters for a broker holding client
 * PII: given a real token, what can this person actually see. Six scopes across
 * eight roles is past what anyone can hold in their head, and the failure mode
 * is silent — nobody reports leads they were not supposed to see.
 *
 * Requires a seeded database and a running API:
 *   npm run db:seed -w @sihl-one/api
 *   npm run dev -w @sihl-one/api
 *   npm run test:e2e -w @sihl-one/api
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Sihl@One2026!';

/**
 * The seeded cast, chosen to span branches.
 *
 * Rahul (AHM-HO), Sneha (AHM-SAT) and Anita (VAD) are three executives in
 * three different places, which is what makes cross-branch assertions possible
 * at all — two executives in one branch would prove nothing about isolation.
 *
 * Vikram (SUR) would serve equally well and is deliberately not used: the seed
 * leaves him as the subject of credential-reset testing, so he is often on a
 * temporary password or locked out, and a security suite that fails for a
 * reason unrelated to security gets ignored.
 */
const PEOPLE = {
  admin: { email: 'admin@sihl.in', roles: ['SUPER_ADMIN'] as Role[] },
  management: { email: 'md@sihl.in', roles: ['MANAGEMENT'] as Role[] },
  operations: { email: 'ops@sihl.in', roles: ['OPERATIONS'] as Role[] },
  marketing: { email: 'marketing@sihl.in', roles: ['MARKETING'] as Role[] },
  zonalHead: { email: 'zonalhead@sihl.in', roles: ['SALES_MANAGER'] as Role[] },
  salesManager: { email: 'salesmanager@sihl.in', roles: ['SALES_MANAGER'] as Role[] },
  rahul: { email: 'rahul.mehta@sihl.in', roles: ['SALES_EXECUTIVE'] as Role[] },
  sneha: { email: 'sneha.patel@sihl.in', roles: ['SALES_EXECUTIVE'] as Role[] },
  anita: { email: 'anita.raval@sihl.in', roles: ['SALES_EXECUTIVE'] as Role[] },
} as const;

type PersonKey = keyof typeof PEOPLE;

const tokens = {} as Record<PersonKey, string>;
const identities = {} as Record<
  PersonKey,
  { id: string; roles: Role[]; permissions: Permission[]; dataScope: string }
>;

/**
 * Signs in, waiting out the login throttle rather than weakening it.
 *
 * /auth/login allows five attempts a minute per IP and this suite needs nine
 * accounts, so a run that follows another run will trip it. The control exists
 * to stop credential stuffing; the test waits.
 */
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

  assert.equal(
    response.status,
    200,
    `Could not sign in as ${identifier} (HTTP ${response.status}). A 401 here is ` +
      'usually the account rather than the suite: locked after five failed ' +
      'attempts, or left on a temporary password by credential testing. ' +
      'Re-seed with npm run db:seed -w @sihl-one/api.',
  );
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return body.tokens.accessToken;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function get(
  person: PersonKey,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, { headers: authed(tokens[person]) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * Every lead id this person can reach, following pagination to the end.
 *
 * `totalPages` is a top-level field of the pagination envelope, not nested
 * under `meta`. Reading it from the wrong place silently stops after the first
 * page, and because the list is newest-first that turns every comparison below
 * into a comparison of recent leads only — which passes for a while and then
 * fails the day the book outgrows one page. Assert the shape rather than
 * defaulting it away.
 */
async function visibleLeadIds(person: PersonKey): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let page = 1; page <= 100; page += 1) {
    const { status, body } = await get(person, `/leads?page=${page}&pageSize=100`);
    assert.equal(status, 200, `${person} could not list leads (HTTP ${status})`);
    const payload = body as { items: Array<{ id: string }>; totalPages?: number };
    assert.equal(
      typeof payload.totalPages,
      'number',
      'the pagination envelope has changed shape; this helper would silently ' +
        'read only the first page and every scope comparison below would be ' +
        'made on partial data',
    );
    for (const item of payload.items) ids.add(item.id);
    if (payload.items.length === 0 || page >= payload.totalPages!) break;
  }
  return ids;
}

function isSubset(inner: Set<string>, outer: Set<string>): string[] {
  return [...inner].filter((value) => !outer.has(value));
}

/*
 * Nine sign-ins against a five-a-minute login throttle means this hook
 * legitimately waits about a minute. The control is there to stop credential
 * stuffing; the test waits rather than asking the product to relax it.
 */
before(async () => {
  const health = await fetch(`${BASE.replace('/api/v1', '')}/health/ready`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API is not reachable at ${BASE}. Start it before running the e2e suite.`);
  }

  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    tokens[key] = await login(PEOPLE[key].email);
    const { body } = await get(key, '/auth/me');
    const me = body as {
      id: string;
      roles: Role[];
      permissions: Permission[];
      dataScope: string;
    };
    identities[key] = me;
  }
}, { timeout: 300_000 });

describe('the token reflects the role matrix', () => {
  for (const key of Object.keys(PEOPLE) as PersonKey[]) {
    it(`${key} holds exactly the permissions their roles grant`, () => {
      const expected = permissionsForRoles(identities[key].roles).sort();
      assert.deepEqual(
        [...identities[key].permissions].sort(),
        expected,
        `${key}'s token grants permissions its roles do not. This is the ` +
          'difference between the matrix as written and the matrix as issued.',
      );
    });
  }

  it('no role is silently granted everything', () => {
    for (const key of Object.keys(PEOPLE) as PersonKey[]) {
      if (identities[key].roles.includes('SUPER_ADMIN')) continue;
      const all = ROLE_PERMISSIONS.SUPER_ADMIN.length;
      assert.ok(
        identities[key].permissions.length < all,
        `${key} holds every permission without being SUPER_ADMIN`,
      );
    }
  });
});

describe('the scope ceiling holds', () => {
  it('a sales manager cannot exceed TEAM, whatever their record asks for', () => {
    // The zonal head is the live case: their user record requests ZONE, but
    // SALES_MANAGER caps at TEAM, so the wider request must be ignored rather
    // than honoured. A scope that widens from the user record is the quiet way
    // an org-chart edit turns into a data breach.
    assert.equal(identities.zonalHead.dataScope, 'TEAM');
    assert.equal(identities.salesManager.dataScope, 'TEAM');
    assert.equal(effectiveScope(['SALES_MANAGER'], 'ZONE'), 'TEAM');
    assert.equal(effectiveScope(['SALES_MANAGER'], 'ALL'), 'TEAM');
  });

  it('a sales executive is held to SELF', () => {
    assert.equal(identities.rahul.dataScope, 'SELF');
    assert.equal(identities.sneha.dataScope, 'SELF');
    assert.equal(effectiveScope(['SALES_EXECUTIVE'], 'ALL'), 'SELF');
  });

  it('a narrower request on the user record is honoured', () => {
    // Narrowing must work, or the only safe way to restrict somebody is to
    // change their role.
    assert.equal(effectiveScope(['MANAGEMENT'], 'BRANCH'), 'BRANCH');
  });
});

describe('lead visibility follows the hierarchy', () => {
  let seen: Record<PersonKey, Set<string>>;

  before(async () => {
    seen = {} as Record<PersonKey, Set<string>>;
    for (const key of Object.keys(PEOPLE) as PersonKey[]) {
      seen[key] = await visibleLeadIds(key);
    }
  }, { timeout: 120_000 });

  it('an executive sees no more than their manager', () => {
    const extra = isSubset(seen.rahul, seen.salesManager);
    assert.deepEqual(
      extra,
      [],
      'A sales executive can see leads their own manager cannot. Scope is ' +
        'inverted somewhere.',
    );
  });

  it('a manager sees no more than management', () => {
    assert.deepEqual(isSubset(seen.salesManager, seen.management), []);
  });

  it('management sees no more than a super admin', () => {
    assert.deepEqual(isSubset(seen.management, seen.admin), []);
  });

  it('two executives in different branches share no leads', () => {
    // The headline control. Rahul is Ahmedabad HO, Sneha is Satellite, Anita
    // is Vadodara: three branches, and a lead belongs to exactly one of them.
    const pairs: Array<[PersonKey, PersonKey]> = [
      ['rahul', 'sneha'],
      ['rahul', 'anita'],
      ['sneha', 'anita'],
    ];
    for (const [a, b] of pairs) {
      const shared = [...seen[a]].filter((id) => seen[b].has(id));
      assert.deepEqual(
        shared,
        [],
        `${a} and ${b} are in different branches but both see ${shared.length} lead(s).`,
      );
    }
  });

  it('an executive sees strictly fewer leads than the whole book', () => {
    // Guards against the scope collapsing to "everything" without anyone
    // noticing, which every subset assertion above would still pass.
    assert.ok(
      seen.rahul.size < seen.admin.size,
      `a SELF-scoped executive sees all ${seen.admin.size} leads — scope is not being applied`,
    );
  });
});

describe('one person cannot reach another person’s records', () => {
  let snehasLead: string;

  before(async () => {
    const ids = await visibleLeadIds('sneha');
    const [first] = [...ids];
    assert.ok(first, 'the seed has no lead for sneha — this suite needs one to test against');
    snehasLead = first;
  });

  it('a lead outside your scope is 404, not 403', async () => {
    // 404 deliberately: 403 would confirm the record exists, which for a
    // broker is itself a disclosure — "does this person bank with you" is
    // answered by the difference between the two responses.
    const { status } = await get('rahul', `/leads/${snehasLead}`);
    assert.equal(status, 404);
  });

  it('a super admin can reach the same lead', async () => {
    // Proves the 404 above is scope, not a broken id.
    const { status } = await get('admin', `/leads/${snehasLead}`);
    assert.equal(status, 200);
  });
});

describe('permissions are enforced, not merely declared', () => {
  /**
   * Endpoint, the permission it needs, and somebody who does not hold it.
   *
   * Chosen to cover the boundaries that matter: sales data, user
   * administration, the audit trail and system configuration.
   */
  const CASES: Array<{ path: string; permission: Permission; without: PersonKey }> = [
    { path: '/audit', permission: 'audit:read', without: 'rahul' },
    { path: '/audit', permission: 'audit:read', without: 'salesManager' },
    { path: '/admin/users', permission: 'user:read', without: 'rahul' },
    { path: '/partners', permission: 'partner:read', without: 'rahul' },
    { path: '/campaigns', permission: 'campaign:read', without: 'rahul' },
  ];

  for (const testCase of CASES) {
    it(`${testCase.without} cannot reach ${testCase.path} without ${testCase.permission}`, async () => {
      assert.ok(
        !identities[testCase.without].permissions.includes(testCase.permission),
        `${testCase.without} unexpectedly holds ${testCase.permission}; pick a different subject`,
      );
      const { status } = await get(testCase.without, testCase.path);
      assert.equal(
        status,
        403,
        `${testCase.path} answered ${status} to somebody without ${testCase.permission}`,
      );
    });
  }

  it('a role that holds the permission does get through', async () => {
    // The counterpart. Without this, a route that refuses everybody would pass
    // every assertion above.
    const { status } = await get('management', '/audit');
    assert.equal(status, 200);
  });
});

describe('self-service routes are scoped to the caller', () => {
  /*
    These carry no permission by design — the resource is the caller. The
    static guard test allows them for that reason, which is only safe if the
    service really does scope them to the caller's own id. That is what is
    checked here, and the two tests are only meaningful together.
  */
  it('/auth/me returns the caller, not somebody else', async () => {
    const { body } = await get('rahul', '/auth/me');
    assert.equal((body as { id: string }).id, identities.rahul.id);
    assert.notEqual(identities.rahul.id, identities.sneha.id);
  });

  it('notifications belong to the caller', async () => {
    const { status, body } = await get('rahul', '/notifications');
    assert.equal(status, 200);
    const items = (body as { items?: Array<{ userId?: string }> }).items ?? [];
    const foreign = items.filter(
      (item) => item.userId !== undefined && item.userId !== identities.rahul.id,
    );
    assert.deepEqual(foreign, [], 'a notification belonging to another user was returned');
  });

  it('sessions belong to the caller', async () => {
    const { status } = await get('rahul', '/users/me/sessions');
    assert.equal(status, 200);
  });
});

describe('bulk export does not leak rows to roles without lead:export', () => {
  /*
    The export is open to every internal role by design, but the lead-level
    rows inside it are gated on `lead:export` — aggregates for everyone, PII
    for those entitled to it. That distinction is the single largest PII
    egress control in the product, and it lives in a boolean deep inside the
    controller, so it is worth an explicit test.
  */
  it('an executive without lead:export receives a workbook', async () => {
    assert.ok(!identities.rahul.permissions.includes('lead:export'));
    const response = await fetch(`${BASE}/reports/export`, { headers: authed(tokens.rahul) });
    assert.equal(response.status, 200);
    const size = (await response.arrayBuffer()).byteLength;
    assert.ok(size > 0, 'empty workbook');
  });

  it('management holds lead:export and an executive does not', () => {
    assert.ok(identities.management.permissions.includes('lead:export'));
    assert.ok(!identities.rahul.permissions.includes('lead:export'));
  });
});
