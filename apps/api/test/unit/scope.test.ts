import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScopeService } from '../../src/common/scope.service';
import type { AuthenticatedPrincipal } from '../../src/common/types';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * ABAC is the control that stops a sales executive reading the whole company's
 * pipeline. The row filters are pure and synchronous by design, precisely so
 * they can be tested exhaustively here rather than only through the API.
 *
 * `ScopeService` is handed Prisma for one method only — `canAssignTo`, which
 * has to look the target user up. Every method below it builds a `where`
 * fragment and never queries, so the shared instance gets a stub that throws
 * the moment anything reaches the database: that keeps the "pure" claim honest
 * rather than letting a filter quietly query through a half-built mock. The
 * two cases that do expect a query build their own Prisma further down.
 */
const noDatabase = {
  get user(): never {
    throw new Error('a row filter must not touch the database');
  },
} as unknown as PrismaService;

const scope = new ScopeService(noDatabase);

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    id: 'user-1',
    email: 'rm@sihl.in',
    fullName: 'Test RM',
    userType: 'INTERNAL',
    roles: ['SALES_EXECUTIVE'],
    permissions: ['lead:read'],
    dataScope: 'SELF',
    orgUnitId: 'ou-branch',
    orgUnitPath: '/root/zone/region/branch/',
    teamUserIds: [],
    partnerId: null,
    sessionId: 'session-1',
    mustChangePassword: false,
    ...overrides,
  };
}

/**
 * A restricted lead filter is OR-ed with two grants keyed to the user's own id:
 * the events they own and the lead products assigned to them. The data-scope
 * rule is the first branch, and these cases are about that rule, so this pulls
 * it back out rather than restating the whole composed `where` each time.
 */
function leadRule(filter: Record<string, unknown>): Record<string, unknown> {
  const branches = filter.OR;
  assert.ok(Array.isArray(branches), 'expected leadScope to OR the scope rule with the grants');
  return branches[0] as Record<string, unknown>;
}

describe('ScopeService — lead filtering', () => {
  it('applies no filter for an unrestricted user', () => {
    // And does not OR anything onto it: the grants would only add work to every
    // query for someone who can already see every row.
    const filter = scope.leadScope(principal({ dataScope: 'ALL' }));
    assert.deepEqual(filter, {});
  });

  it('restricts a SELF user to leads they own', () => {
    const filter = scope.leadScope(principal({ dataScope: 'SELF' }));
    assert.deepEqual(leadRule(filter), { ownerId: 'user-1' });
  });

  it('restricts a partner to leads they sourced, not leads they own', () => {
    const filter = scope.leadScope(
      principal({ dataScope: 'SELF', userType: 'PARTNER', partnerId: 'partner-9' }),
    );
    assert.deepEqual(leadRule(filter), { partnerId: 'partner-9' });
  });

  it('gives a TEAM user their own leads plus their reports', () => {
    const rule = leadRule(
      scope.leadScope(principal({ dataScope: 'TEAM', teamUserIds: ['rep-1', 'rep-2'] })),
    ) as { OR: Array<Record<string, unknown>> };

    assert.ok(Array.isArray(rule.OR));
    assert.deepEqual(rule.OR[0], { ownerId: { in: ['user-1', 'rep-1', 'rep-2'] } });
  });

  it('includes unassigned leads in the org unit for a TEAM user', () => {
    // Deliberate: unassigned leads must be visible to someone, or they sit in a
    // queue nobody is watching.
    const rule = leadRule(scope.leadScope(principal({ dataScope: 'TEAM' }))) as {
      OR: Array<Record<string, unknown>>;
    };
    assert.deepEqual(rule.OR[1], {
      AND: [{ ownerId: null }, { orgUnit: { path: { startsWith: '/root/zone/region/branch/' } } }],
    });
  });

  it('uses a materialised-path prefix for branch scope', () => {
    const filter = scope.leadScope(principal({ dataScope: 'BRANCH' }));
    assert.deepEqual(leadRule(filter), {
      orgUnit: { path: { startsWith: '/root/zone/region/branch/' } },
    });
  });

  it('also reaches the events and lead products the user owns', () => {
    // The two exceptions to "scope decides": an unowned lead from an event this
    // person runs, and a lead carrying a product assigned to them.
    const filter = scope.leadScope(principal({ dataScope: 'SELF' }));
    const branches = filter.OR as Array<Record<string, unknown>>;

    assert.equal(branches.length, 3);
    assert.deepEqual(branches[1], { AND: [{ ownerId: null }, { event: { ownerId: 'user-1' } }] });
    assert.deepEqual(branches[2], { products: { some: { ownerId: 'user-1' } } });
  });

  it('denies everything when a hierarchy-scoped user has no org unit', () => {
    // Fail closed. A user misconfigured with REGION scope but no region must see
    // nothing, never everything.
    const filter = scope.leadScope(principal({ dataScope: 'REGION', orgUnitPath: null }));
    assert.deepEqual(leadRule(filter), { id: '__no_access__' });

    // The branches beside it are the ownership grants, each one keyed to this
    // user's own id — so a missing org unit cannot widen into somebody's subtree.
    assert.equal(JSON.stringify(filter).includes('startsWith'), false);
  });
});

describe('ScopeService — customer filtering', () => {
  it('ties a customer login to its own record only', () => {
    const filter = scope.customerScope(
      principal({ dataScope: 'SELF', userType: 'CUSTOMER', email: 'client@example.com' }),
    );
    assert.deepEqual(filter, { email: 'client@example.com' });
  });

  it('scopes an RM to the customers they manage', () => {
    const filter = scope.customerScope(principal({ dataScope: 'SELF' }));
    assert.deepEqual(filter, { relationshipManagerId: 'user-1' });
  });

  it('scopes a manager to their team', () => {
    const filter = scope.customerScope(
      principal({ dataScope: 'TEAM', teamUserIds: ['rep-1'] }),
    );
    assert.deepEqual(filter, { relationshipManagerId: { in: ['user-1', 'rep-1'] } });
  });
});

describe('ScopeService — who may receive work', () => {
  // The pure half of assignment: one definition, used both to build the
  // "assign to" list and to check the id that comes back from it.
  it('offers a self-scoped user nobody but themselves', () => {
    assert.deepEqual(scope.assignableUserScope(principal({ dataScope: 'SELF' })), { id: 'user-1' });
  });

  it('offers a manager their own team', () => {
    const user = principal({ dataScope: 'TEAM', teamUserIds: ['rep-1'] });
    assert.deepEqual(scope.assignableUserScope(user), { id: { in: ['user-1', 'rep-1'] } });
  });

  it('offers a branch manager their whole subtree, not just direct reports', () => {
    assert.deepEqual(scope.assignableUserScope(principal({ dataScope: 'BRANCH' })), {
      OR: [{ id: 'user-1' }, { orgUnit: { path: { startsWith: '/root/zone/region/branch/' } } }],
    });
  });

  it('keeps a partner inside their own firm whatever scope their login carries', () => {
    const user = principal({ dataScope: 'ALL', userType: 'PARTNER', partnerId: 'partner-9' });
    assert.deepEqual(scope.assignableUserScope(user), { partnerId: 'partner-9' });
  });

  it('opens the list up for anyone actually holding lead:assign', () => {
    // Otherwise the right to hand work on comes with nobody to hand it to.
    const user = principal({ dataScope: 'SELF', permissions: ['lead:read', 'lead:assign'] });
    assert.deepEqual(scope.assignableUserScope(user), {});
  });
});

/**
 * `canAssignTo` is the one method here that queries: whether a target is in
 * scope depends on where *they* sit, which the principal does not carry. This
 * fake records the `where` it is handed and answers with the row the test
 * chose, so the cases below assert what the query asks the database — rather
 * than reimplementing Prisma's matching and asserting against that.
 */
function withUserLookup(match: { id: string } | null) {
  const wheres: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        return match;
      },
    },
  } as unknown as PrismaService;
  return { scoped: new ScopeService(prisma), wheres };
}

describe('ScopeService — assignment authority', () => {
  // These two run against the shared instance, whose Prisma throws — so they
  // also pin the two answers that must not cost a query.
  it('lets anyone assign to themselves without a lookup', async () => {
    assert.equal(await scope.canAssignTo(principal({ dataScope: 'SELF' }), 'user-1'), true);
  });

  it('lets an unrestricted user assign to anyone without a lookup', async () => {
    assert.equal(await scope.canAssignTo(principal({ dataScope: 'ALL' }), 'anyone'), true);
  });

  it('asks for the target *and* the assignable scope, not either one', async () => {
    const { scoped, wheres } = withUserLookup({ id: 'rep-1' });
    const user = principal({ dataScope: 'TEAM', teamUserIds: ['rep-1'] });

    assert.equal(await scoped.canAssignTo(user, 'rep-1'), true);

    // Both constraints have to hold of one row. Spreading the scope beside the
    // id overwrote it — a TEAM filter is `{ id: { in: [...] } }` — so the query
    // asked only "is anyone on my team active?", which is true no matter who
    // the target is.
    assert.deepEqual(wheres[0], {
      id: 'rep-1',
      deletedAt: null,
      status: 'ACTIVE',
      AND: [{ id: { in: ['user-1', 'rep-1'] } }],
    });
  });

  it('refuses a target that matches no row inside the scope', async () => {
    const { scoped, wheres } = withUserLookup(null);
    const user = principal({ dataScope: 'TEAM', teamUserIds: ['rep-1'] });

    assert.equal(await scoped.canAssignTo(user, 'rep-from-another-branch'), false);
    assert.equal(wheres.length, 1, 'expected the out-of-team target to be checked, not assumed');
  });
});

describe('attendee visibility', () => {
  it('lets a scoped user reach a task they attended', () => {
    const where = scope.taskScope(principal({ dataScope: 'SELF' }));

    // The base rule plus the attendance exception, as alternatives.
    assert.ok(Array.isArray(where.OR), 'expected an OR of base and attendance');
    const branches = where.OR as Record<string, unknown>[];
    assert.equal(branches.length, 2);
    assert.deepEqual(branches[1], { attendees: { some: { userId: 'user-1' } } });
  });

  it('does the same for visits', () => {
    const where = scope.visitScope(principal({ dataScope: 'TEAM', teamUserIds: ['u2'] }));

    const branches = where.OR as Record<string, unknown>[];
    assert.deepEqual(branches[0], { userId: { in: ['user-1', 'u2'] } });
    assert.deepEqual(branches[1], { attendees: { some: { userId: 'user-1' } } });
  });

  it('does not widen an already unscoped role', () => {
    // ALL sees everything; an OR here would be noise in every query.
    assert.deepEqual(scope.taskScope(principal({ dataScope: 'ALL' })), {});
    assert.deepEqual(scope.visitScope(principal({ dataScope: 'ALL' })), {});
  });

  it('grants the record, not the wider book', () => {
    const where = scope.taskScope(principal({ dataScope: 'SELF' }));
    const attendance = (where.OR as Record<string, unknown>[])[1]!;

    // No assigneeId, no org unit — attendance must not leak anything adjacent.
    assert.equal(JSON.stringify(attendance).includes('assigneeId'), false);
    assert.equal(JSON.stringify(attendance).includes('orgUnit'), false);
  });
});
