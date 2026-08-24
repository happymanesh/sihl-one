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
