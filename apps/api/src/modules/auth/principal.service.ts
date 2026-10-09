import { Injectable } from '@nestjs/common';
import {
  effectiveScope,
  withLeadAssignSwitch,
  type DataScope,
  type Permission,
  type Role,
} from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/types';

/**
 * Rebuilds the authenticated principal from the database on every request.
 *
 * Cost: one indexed query per request. Benefit: revoking a session, suspending
 * an account or changing a role takes effect on the next call rather than at
 * the next token refresh. For a system holding customer PII, up to 15 minutes
 * of stale authority is not a trade worth making.
 *
 * When this becomes a measured bottleneck the fix is a short-TTL Redis cache
 * keyed by sessionId with explicit invalidation on role/session change — not
 * trusting the token's claims.
 */
@Injectable()
export class PrincipalService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, sessionId: string): Promise<AuthenticatedPrincipal | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { include: { role: true } },
        orgUnit: { select: { id: true, path: true } },
        designation: { select: { canAccessEvents: true, isActive: true } },
        reports: { where: { deletedAt: null }, select: { id: true } },
      },
    });

    if (!user) return null;
    if (user.status !== 'ACTIVE') return null;

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!session) return null;

    // Permissions come from the Role rows, which the seed populates from the
    // contracts matrix. The database is authoritative at runtime so compliance
    // can adjust a role without a deployment.
    const roles = user.roles.map((assignment) => assignment.role.code as Role);
    let permissions = [
      ...new Set(user.roles.flatMap((assignment) => assignment.role.permissions as Permission[])),
    ];

    /*
      Event access, granted by two switches rather than by a role.

      This belongs here and not at sign-in, because this is the only place
      permissions are actually decided — the token's `perms` claim is never read
      by the guard. Putting it here also makes the switch take effect on the
      very next request instead of at the next token refresh, which is the
      behaviour an administrator expects from something that looks like a
      switch.

      Costs a query only for the people it could apply to: roles that already
      carry the permission short-circuit, and so does a level with the switch
      off, which is almost everyone.
    */
    if (
      !permissions.includes('event:view') &&
      user.designation?.isActive &&
      user.designation.canAccessEvents &&
      user.orgUnit
    ) {
      const chain = user.orgUnit.path.split('/').filter(Boolean);
      if (chain.length > 0) {
        const opened = await this.prisma.orgUnit.count({
          where: { id: { in: chain }, canAccessEvents: true, isActive: true },
        });
        if (opened > 0) permissions.push('event:view');
      }
    }

    /*
      The one switch that decides who may hand work to somebody else.

      "May assign leads to other people" on the user record is the whole answer,
      whatever role, designation or access that person has. Ticked, they hold
      `lead:assign`; cleared, they do not. The product owner asked for exactly
      this, and the reason is practical: `lead:assign` sat in one role only, so
      a rep with the box ticked was still refused and the box appeared to do
      nothing. A setting that is visibly on and has no effect is worse than no
      setting.

      It replaces a subtract-only switch. That earlier design kept roles as the
      single source of authority and is the safer shape in the abstract — but it
      cannot express "this person, regardless of role", which is the thing being
      asked for. The trade is stated here so it is not rediscovered as a bug:
      asking why somebody can assign now means reading this flag, not the role
      matrix.

      Granting it is narrower than it sounds. What you may do with it is still
      bounded elsewhere: `ownsLeadProduct` restricts you to the products you are
      working, and `canAssignTo` restricts who you may hand them to. The switch
      opens the door; it does not widen the room.

      Applied here rather than at each call site so every guard, dropdown and
      `can()` in the UI inherits it — the assign and transfer routes are already
      gated on this permission and need no change.
    */
    permissions = withLeadAssignSwitch(permissions, user.canAssignLeads);

    // Touch lastSeenAt without awaiting, so it never adds a write round-trip to
    // the critical path of every request.
    //
    // This is no longer only telemetry: the idle timeout in AuthService.refresh
    // measures against this column, so a session that stops being touched will
    // be signed out. Do not remove it as a spare write.
    void this.prisma.session
      .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    return {
      id: user.id,
      email: user.email,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      userType: user.userType,
      roles,
      permissions,
      dataScope: effectiveScope(roles, user.dataScope as DataScope | null),
      orgUnitId: user.orgUnitId,
      orgUnitPath: user.orgUnit?.path ?? null,
      teamUserIds: user.reports.map((report) => report.id),
      partnerId: user.partnerId,
      sessionId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
