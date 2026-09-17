import { Injectable } from '@nestjs/common';
import { canTransferLeads } from '@sihl-one/contracts';

import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Candidate owners for a lead or task.
   *
   * The list is derived from the caller's scope rather than returning the whole
   * directory: an owner picker showing 400 names the caller cannot actually
   * assign to is both a bad experience and an org-chart leak.
   */
  /**
   * Users this caller may hand work to.
   *
   * `forTransfer` widens the list past the caller's own team, and is honoured
   * only for someone who may actually transfer. A rep who cannot would
   * otherwise get a picker full of names the API will refuse — and, worse, a
   * roster of the firm they have no business reading.
   */
  async assignable(user: AuthenticatedPrincipal, search?: string, forTransfer = false) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: 'ACTIVE',
      userType: 'INTERNAL',
    };

    const widen = forTransfer && canTransferLeads(user.dataScope);
    if (user.dataScope !== 'ALL' && !widen) {
      where.id = { in: [user.id, ...user.teamUserIds] };
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatarUrl: true,
        orgUnit: { select: { name: true } },
        roles: { select: { roleCode: true } },
      },
      orderBy: [{ firstName: 'asc' }],
      take: 100,
    });

    return users.map((row) => ({
      id: row.id,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      avatarUrl: row.avatarUrl,
      orgUnit: row.orgUnit?.name ?? null,
      roles: row.roles.map((assignment) => assignment.roleCode),
    }));
  }

  /**
   * Colleagues this caller could bring along on a visit.
   *
   * Deliberately **not** `assignable`. That list answers "who may I hand this
   * lead to", which is a permission question bounded by the caller's own team —
   * widening it to fill an attendee picker would quietly widen who can be given
   * ownership of a client, which is a different and much more consequential
   * thing. Two questions, two lists.
   *
   * The reach here is wider on purpose and carries far less: a name and an
   * employee code, of people who already work together. A sales executive saw
   * nobody at all, so the feature simply did not exist for the role it was
   * built for — the whole point being a junior rep bringing someone senior to
   * help close.
   *
   * Zonal head and above see everybody. Everyone below sees their own region.
   * Partner logins see the other people at their own partner firm. When the
   * firm outgrows this, it becomes a policy rather than a rule here.
   */
  async colleagues(user: AuthenticatedPrincipal, search?: string) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      status: 'ACTIVE',
      // Never yourself: you are already on the visit.
      id: { not: user.id },
    };

    if (user.userType === 'PARTNER') {
      // A partner's people see each other and no further. Without the guard on
      // partnerId an unattached partner login would match every other one.
      if (!user.partnerId) return [];
      where.userType = 'PARTNER';
      where.partnerId = user.partnerId;
    } else {
      where.userType = 'INTERNAL';

      // ZONE and ALL are "zonal head and above". Everyone narrower is held to
      // the region they sit in.
      const seesEverybody = user.dataScope === 'ALL' || user.dataScope === 'ZONE';
      if (!seesEverybody) {
        const regionPath = await this.regionPathFor(user.orgUnitPath);
        if (!regionPath) return [];
        where.orgUnit = { path: { startsWith: regionPath } };
      }
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        orgUnit: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 200,
    });

    return users.map((row) => ({
      id: row.id,
      fullName: `${row.firstName} ${row.lastName ?? ''}`.trim(),
      // The picker shows this in brackets. Two people called Priya Shah is not
      // hypothetical in a firm this size, and picking the wrong one puts a
      // colleague's name against a client meeting they never attended.
      employeeCode: row.employeeCode,
      orgUnit: row.orgUnit?.name ?? null,
    }));
  }

  /**
   * The path of the REGION this org unit sits under.
   *
   * The materialised path is `/id/id/id/`, ancestors outermost, so the whole
   * chain is already in hand — one query resolves which of those ids is the
   * region rather than walking up parent by parent.
   *
   * Falls back to the caller's own subtree when there is no region above them,
   * which is the head-office case: better a short, correct list than the whole
   * firm handed to somebody whose hierarchy simply is not filled in.
   */
  private async regionPathFor(orgUnitPath: string | null): Promise<string | null> {
    if (!orgUnitPath) return null;

    const ancestorIds = orgUnitPath.split('/').filter(Boolean);
    if (ancestorIds.length === 0) return null;

    const region = await this.prisma.orgUnit.findFirst({
      where: { id: { in: ancestorIds }, type: 'REGION' },
      select: { path: true },
    });

    return region?.path ?? orgUnitPath;
  }

  /** Device management: which sessions are live, and which one is this one. */
  async activeSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        userAgent: true,
        ipAddress: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      isCurrent: session.id === currentSessionId,
      deviceLabel: session.deviceLabel ?? this.describeUserAgent(session.userAgent),
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt.toISOString(),
      signedInAt: session.createdAt.toISOString(),
    }));
  }

  private describeUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';
    if (/android/i.test(userAgent)) return 'Android device';
    if (/iphone|ipad/i.test(userAgent)) return 'iOS device';
    if (/edg\//i.test(userAgent)) return 'Edge on desktop';
    if (/chrome/i.test(userAgent)) return 'Chrome on desktop';
    if (/firefox/i.test(userAgent)) return 'Firefox on desktop';
    if (/safari/i.test(userAgent)) return 'Safari on desktop';
    return 'Unknown device';
  }
}
