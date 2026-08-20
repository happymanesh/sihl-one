import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScopeService } from '../../src/common/scope.service';
import type { AuthenticatedPrincipal } from '../../src/common/types';

/**
 * ABAC is the control that stops a sales executive reading the whole company's
 * pipeline. It is pure and synchronous by design, precisely so it can be tested
 * exhaustively here rather than only through the API.
 */
const scope = new ScopeService();

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

describe('ScopeService — lead filtering', () => {
  it('applies no filter for an unrestricted user', () => {
    const filter = scope.leadScope(principal({ dataScope: 'ALL' }));
    assert.deepEqual(filter, {});
  });

  it('restricts a SELF user to leads they own', () => {
    const filter = scope.leadScope(principal({ dataScope: 'SELF' }));
    assert.deepEqual(filter, { ownerId: 'user-1' });
  });

  it('restricts a partner to leads they sourced, not leads they own', () => {
    const filter = scope.leadScope(
      principal({ dataScope: 'SELF', userType: 'PARTNER', partnerId: 'partner-9' }),
    );
    assert.deepEqual(filter, { partnerId: 'partner-9' });
  });

  it('gives a TEAM user their own leads plus their reports', () => {
    const filter = scope.leadScope(
      principal({ dataScope: 'TEAM', teamUserIds: ['rep-1', 'rep-2'] }),
    ) as { OR: Array<Record<string, unknown>> };

    assert.ok(Array.isArray(filter.OR));
    assert.deepEqual(filter.OR[0], { ownerId: { in: ['user-1', 'rep-1', 'rep-2'] } });
  });

  it('includes unassigned leads in the org unit for a TEAM user', () => {
    // Deliberate: unassigned leads must be visible to someone, or they sit in a
    // queue nobody is watching.
    const filter = scope.leadScope(principal({ dataScope: 'TEAM' })) as {
      OR: Array<Record<string, unknown>>;
    };
    assert.deepEqual(filter.OR[1], {
      AND: [{ ownerId: null }, { orgUnit: { path: { startsWith: '/root/zone/region/branch/' } } }],
    });
  });

  it('uses a materialised-path prefix for branch scope', () => {
    const filter = scope.leadScope(principal({ dataScope: 'BRANCH' }));
    assert.deepEqual(filter, { orgUnit: { path: { startsWith: '/root/zone/region/branch/' } } });
  });

  it('denies everything when a hierarchy-scoped user has no org unit', () => {
    // Fail closed. A user misconfigured with BRANCH scope but no branch must see
    // nothing, never everything.
    const filter = scope.leadScope(principal({ dataScope: 'REGION', orgUnitPath: null }));
    assert.deepEqual(filter, { id: '__no_access__' });
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

describe('ScopeService — assignment authority', () => {
  it('lets an unrestricted user assign to anyone', () => {
    assert.equal(scope.canAssignTo(principal({ dataScope: 'ALL' }), 'anyone'), true);
  });

  it('lets a self-scoped user assign only to themselves', () => {
    const user = principal({ dataScope: 'SELF' });
    assert.equal(scope.canAssignTo(user, 'user-1'), true);
    assert.equal(scope.canAssignTo(user, 'someone-else'), false);
  });

  it('lets a manager assign within their team but not outside it', () => {
    const user = principal({ dataScope: 'TEAM', teamUserIds: ['rep-1'] });
    assert.equal(scope.canAssignTo(user, 'rep-1'), true);
    assert.equal(scope.canAssignTo(user, 'user-1'), true);
    assert.equal(scope.canAssignTo(user, 'rep-from-another-branch'), false);
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
