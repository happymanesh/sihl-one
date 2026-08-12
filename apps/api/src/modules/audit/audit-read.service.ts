import { Injectable } from '@nestjs/common';
import {
  isSecurityRelevant,
  SECURITY_AUDIT_ACTIONS,
  summariseAuditEntry,
  type AuditChange,
  type AuditEntryView,
  type AuditQuery,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reading the audit trail.
 *
 * Separate from `AuditService`, which writes it. Keeping the reader out of the
 * writer means nothing in the request path can accidentally acquire the ability
 * to query the trail, and the writer's class surface stays `record()` only.
 *
 * There is no update or delete here and there is no code path to add one: the
 * table is append-only, and the runtime database role is granted INSERT and
 * SELECT on it.
 */
@Injectable()
export class AuditReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: AuditQuery,
  ): Promise<PaginatedResult<AuditEntryView>> {
    const and: Record<string, unknown>[] = [];

    if (query.q) {
      and.push({
        OR: [
          { actorLabel: { contains: query.q, mode: 'insensitive' } },
          { resource: { contains: query.q, mode: 'insensitive' } },
          { resourceId: { contains: query.q, mode: 'insensitive' } },
          { traceId: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }

    if (query.action) and.push({ action: query.action });
    if (query.resource) and.push({ resource: query.resource });
    if (query.resourceId) and.push({ resourceId: query.resourceId });
    if (query.actorId) and.push({ actorId: query.actorId });

    if (query.securityOnly) {
      and.push({
        OR: [
          { action: { in: [...SECURITY_AUDIT_ACTIONS] } },
          { resource: { startsWith: 'security.' } },
        ],
      });
    }

    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          // Inclusive of the whole "to" day. A compliance officer filtering to
          // today and seeing nothing from today is a bug report every time.
          ...(query.to ? { lte: endOfDay(query.to) } : {}),
        },
      });
    }

    const where = and.length ? { AND: and } : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Reading the audit trail is itself an auditable event. Recording the shape
    // of the query rather than the rows returned keeps the entry small and
    // still answers "who went looking, for what".
    await this.audit.record({
      action: 'READ',
      resource: 'audit_log',
      changes: {
        filters: {
          q: query.q ?? null,
          action: query.action ?? null,
          resource: query.resource ?? null,
          actorId: query.actorId ?? null,
          securityOnly: query.securityOnly ?? false,
        },
        matched: total,
      },
    });

    return paginate(rows.map(toView), total, query.page, query.pageSize);
  }

  /**
   * Everything that ever happened to one record.
   *
   * Used by the "History" panel on a lead or customer, so it takes the resource
   * and id rather than a free-form filter.
   */
  async forResource(
    user: AuthenticatedPrincipal,
    resource: string,
    resourceId: string,
    limit = 50,
  ): Promise<AuditEntryView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { resource, resourceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });

    return rows.map(toView);
  }

  /** Counts for the header strip, over the same window the screen shows. */
  async summary(days = 7): Promise<{
    days: number;
    total: number;
    security: number;
    failedLogins: number;
    exports: number;
    permissionDenials: number;
    distinctActors: number;
  }> {
    const from = new Date(Date.now() - days * 86_400_000);
    const where = { createdAt: { gte: from } };

    const [total, failedLogins, exports, permissionDenials, actors, security] =
      await this.prisma.$transaction([
        this.prisma.auditLog.count({ where }),
        this.prisma.auditLog.count({ where: { ...where, action: 'LOGIN_FAILED' } }),
        this.prisma.auditLog.count({ where: { ...where, action: 'EXPORT' } }),
        this.prisma.auditLog.count({ where: { ...where, action: 'PERMISSION_DENIED' } }),
        this.prisma.auditLog.findMany({
          where: { ...where, actorId: { not: null } },
          distinct: ['actorId'],
          select: { actorId: true },
        }),
        this.prisma.auditLog.count({
          where: {
            ...where,
            OR: [
              { action: { in: [...SECURITY_AUDIT_ACTIONS] } },
              { resource: { startsWith: 'security.' } },
            ],
          },
        }),
      ]);

    return {
      days,
      total,
      security,
      failedLogins,
      exports,
      permissionDenials,
      distinctActors: actors.length,
    };
  }
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

interface AuditRow {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorLabel: string | null;
  changes: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  traceId: string | null;
  createdAt: Date;
  actor: { id: string; firstName: string; lastName: string } | null;
}

function toView(row: AuditRow): AuditEntryView {
  // `changes` was sanitised on the way in — PAN, password hashes and tokens are
  // already '[redacted]', mobiles and emails already masked. Nothing here
  // reverses that.
  const changes = (row.changes ?? null) as Record<string, AuditChange> | null;

  return {
    id: row.id,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    actor: row.actor
      ? { id: row.actor.id, fullName: `${row.actor.firstName} ${row.actor.lastName}`.trim() }
      : null,
    actorLabel: row.actorLabel,
    changes,
    reason: row.reason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    traceId: row.traceId,
    createdAt: row.createdAt.toISOString(),
    summary: summariseAuditEntry({
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId,
      actorLabel: row.actorLabel,
      changes,
    }),
    isSecurityRelevant: isSecurityRelevant(row.action, row.resource),
  };
}
