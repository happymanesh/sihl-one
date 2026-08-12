import { Injectable } from '@nestjs/common';

import type { AuthenticatedPrincipal } from './types';

/**
 * ABAC row filtering.
 *
 * Authorisation in this system is two independent checks and both must pass:
 *
 *   1. RBAC  — "may this role perform this action at all?"  (PermissionsGuard)
 *   2. ABAC  — "on which rows?"                             (this service)
 *
 * Passing (1) and skipping (2) is how CRMs leak: a sales executive legitimately
 * holds `lead:read`, and without a row filter that permission returns every
 * lead in the company. So the filter is not an optional refinement applied by
 * whoever remembers — every repository query composes it, and the e2e suite
 * asserts a scoped user cannot read out-of-scope rows.
 *
 * The filters return Prisma `where` fragments rather than raw SQL so they
 * compose with the rest of a query and cannot be injected into.
 */
@Injectable()
export class ScopeService {
  /**
   * Row filter for entities that carry `ownerId` + `orgUnitId`
   * (leads, opportunities).
   */
  leadScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    switch (user.dataScope) {
      case 'ALL':
        return {};

      case 'ZONE':
      case 'REGION':
      case 'BRANCH':
        // Subtree match on the materialised path. `startsWith` on an indexed
        // varchar is a range scan, not a recursive walk.
        return user.orgUnitPath
          ? { orgUnit: { path: { startsWith: user.orgUnitPath } } }
          : { id: '__no_access__' };

      case 'TEAM':
        // A manager sees their own leads and their reports'. Unassigned leads
        // inside their org unit are included deliberately: someone has to see
        // them or they rot in the queue unclaimed.
        return {
          OR: [
            { ownerId: { in: [user.id, ...user.teamUserIds] } },
            user.orgUnitPath
              ? { AND: [{ ownerId: null }, { orgUnit: { path: { startsWith: user.orgUnitPath } } }] }
              : { id: '__no_access__' },
          ],
        };

      case 'SELF':
      default:
        // Partners see leads they sourced; everyone else sees leads they own.
        return user.partnerId ? { partnerId: user.partnerId } : { ownerId: user.id };
    }
  }

  /** Row filter for customers, which use `relationshipManagerId` as the owner. */
  customerScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    switch (user.dataScope) {
      case 'ALL':
        return {};

      case 'ZONE':
      case 'REGION':
      case 'BRANCH':
        return user.orgUnitPath
          ? { orgUnit: { path: { startsWith: user.orgUnitPath } } }
          : { id: '__no_access__' };

      case 'TEAM':
        return { relationshipManagerId: { in: [user.id, ...user.teamUserIds] } };

      case 'SELF':
      default:
        if (user.userType === 'CUSTOMER') {
          // A customer login may only ever see its own record. Matching on the
          // authenticated email is the link between the login and the customer
          // row until the two are joined by id in Phase 2.
          return { email: user.email };
        }
        return user.partnerId
          ? { partnerId: user.partnerId }
          : { relationshipManagerId: user.id };
    }
  }

  /** Row filter for tasks. Tasks are personal; scope only widens for managers. */
  taskScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    switch (user.dataScope) {
      case 'ALL':
        return {};
      case 'ZONE':
      case 'REGION':
      case 'BRANCH':
      case 'TEAM':
        return { assigneeId: { in: [user.id, ...user.teamUserIds] } };
      case 'SELF':
      default:
        return { OR: [{ assigneeId: user.id }, { createdById: user.id }] };
    }
  }

  /**
   * Row filter for field visits.
   *
   * A visit is a record of where a named person physically was, so it is more
   * sensitive than a lead, and the default is tighter: even a branch-scoped
   * user sees their own team's visits rather than the whole branch's. Only a
   * fully unscoped role sees everything.
   */
  visitScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    switch (user.dataScope) {
      case 'ALL':
        return {};
      case 'ZONE':
      case 'REGION':
      case 'BRANCH':
      case 'TEAM':
        return { userId: { in: [user.id, ...user.teamUserIds] } };
      case 'SELF':
      default:
        return { userId: user.id };
    }
  }

  /**
   * Can this user take ownership decisions about this owner id?
   * Used when assigning a lead: a manager may assign within their team, an
   * unscoped role may assign to anyone, a self-scoped user only to themselves.
   */
  canAssignTo(user: AuthenticatedPrincipal, targetUserId: string): boolean {
    if (user.dataScope === 'ALL') return true;
    if (user.dataScope === 'SELF') return targetUserId === user.id;
    return targetUserId === user.id || user.teamUserIds.includes(targetUserId);
  }
}
