import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
              ? {
                  AND: [{ ownerId: null }, { orgUnit: { path: { startsWith: user.orgUnitPath } } }],
                }
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
        return user.partnerId ? { partnerId: user.partnerId } : { relationshipManagerId: user.id };
    }
  }

  /** Row filter for tasks. Tasks are personal; scope only widens for managers. */
  taskScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    const base = (() => {
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
    })();

    return this.orAttended(base, user);
  }

  /**
   * Widen a scope to include records the user was recorded as attending.
   *
   * A product expert brought in from another branch is outside the org subtree,
   * so without this they cannot open the very thing they were asked to attend —
   * which surfaces as "why can't I see the client I sat with yesterday?" and
   * gets reported as a bug.
   *
   * Deliberately narrow: it grants that one record, not the branch, not the
   * owner's book. It is the first rule here that reaches outside the org tree,
   * so it stays as small as it can be.
   */
  private orAttended(
    base: Record<string, unknown>,
    user: AuthenticatedPrincipal,
  ): Record<string, unknown> {
    // An unscoped role already sees everything; widening it further is noise.
    if (Object.keys(base).length === 0) return base;

    const attended = { attendees: { some: { userId: user.id } } };
    return { OR: [base, attended] };
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
    const base = (() => {
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
    })();

    return this.orAttended(base, user);
  }

  /**
   * Can this user take ownership decisions about this owner id?
   * Used when assigning a lead: a manager may assign within their team, an
   * unscoped role may assign to anyone, a self-scoped user only to themselves.
   */
  /**
   * Row filter for the people this person may hand work to.
   *
   * One definition, used both to build the "assign to" list and to check the id
   * that comes back from it. Two rules is how a dropdown offers a name the save
   * then refuses.
   *
   * Each scope keeps the meaning it already has elsewhere:
   *
   *   SELF     themselves and nobody else, so a sales executive's imports land
   *            on them because there is no one else to choose.
   *   TEAM     themselves and their direct reports — a team leader's team is the
   *            people who report to them, not everyone in the building.
   *   BRANCH,  themselves and everyone beneath them in the org tree. This is what
   *   REGION,  "their vertical" means for a branch, regional or zonal manager,
   *   ZONE     and it is the rule that changed: it was direct reports only, so a
   *            regional head could not reach a rep two levels down.
   *   ALL      anyone — management, operations, marketing, super admin.
   *
   * A partner is decided before scope: they hand work inside their own firm,
   * whatever scope their login carries. Their staff sit outside SIHL's org tree,
   * so a subtree match would return nobody at all.
   */
  assignableUserScope(user: AuthenticatedPrincipal): Record<string, unknown> {
    if (user.partnerId) return { partnerId: user.partnerId };

    switch (user.dataScope) {
      case 'ALL':
        return {};

      case 'ZONE':
      case 'REGION':
      case 'BRANCH':
        return user.orgUnitPath
          ? { OR: [{ id: user.id }, { orgUnit: { path: { startsWith: user.orgUnitPath } } }] }
          : { id: user.id };

      case 'TEAM':
        return { id: { in: [user.id, ...user.teamUserIds] } };

      case 'SELF':
      default:
        return { id: user.id };
    }
  }

  /**
   * Whether this person may hand work to that one.
   *
   * Asynchronous because the answer depends on where the *target* sits, which
   * the principal does not carry. One indexed lookup; the alternative is
   * trusting a list the client was handed earlier, which is how a stale dropdown
   * becomes a way to assign leads out of scope.
   */
  async canAssignTo(user: AuthenticatedPrincipal, targetUserId: string): Promise<boolean> {
    // Two answers that need no query: anyone may assign to themselves, and an
    // unrestricted scope may assign to anyone.
    if (targetUserId === user.id) return true;
    if (user.dataScope === 'ALL' && !user.partnerId) return true;

    const match = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        deletedAt: null,
        status: 'ACTIVE',
        ...this.assignableUserScope(user),
      },
      select: { id: true },
    });

    return Boolean(match);
  }
}
