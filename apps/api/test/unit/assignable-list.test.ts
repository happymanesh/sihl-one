import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ScopeService } from '../../src/common/scope.service';
import type { AuthenticatedPrincipal } from '../../src/common/types';
import { UsersService } from '../../src/modules/users/users.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * The owner picker is a roster of the firm when its filter slips, and the
 * filter is two `OR`s that have to coexist: the caller's assignable scope
 * ("me, or anybody in my subtree") and the search ("first name, or last name,
 * or email"). Written side by side on one `where` the second replaced the
 * first, so a branch manager who typed into the box was answered with every
 * active internal user — a leak reachable without any special privilege.
 *
 * So these assert the `where` the service hands Prisma, rather than rows: what
 * went wrong was the question being asked, not the answer coming back.
 */
function usersWith(captured: { where?: Record<string, unknown> }) {
  const prisma = {
    user: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        captured.where = where;
        return [];
      },
    },
  } as unknown as PrismaService;
  return new UsersService(prisma, new ScopeService(prisma));
}

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    id: 'user-1',
    email: 'branch.head@sihl.in',
    fullName: 'Test Branch Head',
    userType: 'INTERNAL',
    roles: ['SALES_MANAGER'],
    permissions: ['lead:read'],
    dataScope: 'BRANCH',
    orgUnitId: 'ou-branch',
    orgUnitPath: '/root/zone/region/branch/',
    teamUserIds: [],
    partnerId: null,
    sessionId: 'session-1',
    mustChangePassword: false,
    ...overrides,
  };
}

const subtree = {
  OR: [{ id: 'user-1' }, { orgUnit: { path: { startsWith: '/root/zone/region/branch/' } } }],
};

describe('the assignable list', () => {
  it('scopes the list when nothing is searched for', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    await usersWith(captured).assignable(principal());

    assert.deepEqual(captured.where?.AND, [subtree]);
  });

  it('keeps the scope when a search term is typed', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    await usersWith(captured).assignable(principal(), 'pri');

    // Both survive, as separate conjuncts: the scope, and the name match.
    assert.deepEqual(captured.where?.AND, [
      subtree,
      {
        OR: [
          { firstName: { contains: 'pri', mode: 'insensitive' } },
          { lastName: { contains: 'pri', mode: 'insensitive' } },
          { email: { contains: 'pri', mode: 'insensitive' } },
        ],
      },
    ]);

    // And nothing wrote an `OR` straight onto `where`, which is how the scope
    // came to be dropped in the first place.
    assert.equal(captured.where?.OR, undefined);
  });

  it('still refuses to widen for someone who may not transfer', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    const rep = principal({ dataScope: 'SELF', orgUnitPath: null });
    await usersWith(captured).assignable(rep, 'pri', true);

    // `forTransfer` is a request, not a grant: a SELF-scoped rep asking for the
    // transfer list still gets themselves and the search, not the directory.
    const and = captured.where?.AND as Record<string, unknown>[];
    assert.deepEqual(and[0], { id: 'user-1' });
    assert.equal(and.length, 2);
  });

  it('widens past the scope for someone who may transfer', async () => {
    const captured: { where?: Record<string, unknown> } = {};
    await usersWith(captured).assignable(principal(), undefined, true);

    // Deliberate: a transfer is the one case that reaches outside the caller's
    // own vertical, and `canTransferLeads` has already said they may.
    assert.equal(captured.where?.AND, undefined);
    assert.equal(captured.where?.userType, 'INTERNAL');
  });
});
