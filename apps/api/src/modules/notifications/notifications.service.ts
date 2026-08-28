import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_RETENTION_DAYS,
  type MarkReadInput,
  type NotificationListQuery,
  type NotificationType,
  type NotificationView,
} from '@sihl-one/contracts';

import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The bell.
 *
 * There is no data-scope filter anywhere in here, and that is not an omission:
 * a notification is addressed to exactly one person, so `userId` is the whole
 * access check. Every query in this service is scoped to the caller's own id,
 * including the writes — a user cannot mark somebody else's notification read
 * because the update's WHERE clause never matches.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthenticatedPrincipal,
    query: NotificationListQuery,
  ): Promise<PaginatedResult<NotificationView>> {
    const where = {
      userId: user.id,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(
      rows.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * The number on the badge.
   *
   * Its own endpoint because the app shell asks for it on every page and has no
   * use for the rows — fetching twenty notifications to render "3" would put a
   * pointless query on every navigation in the product.
   */
  async unreadCount(user: AuthenticatedPrincipal): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });
    return { unread };
  }

  async markRead(user: AuthenticatedPrincipal, input: MarkReadInput): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      // Already-read rows are excluded so a second click does not move the
      // timestamp; when it was first seen is the more useful fact.
      where: { id: { in: input.ids }, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async markAllRead(user: AuthenticatedPrincipal): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * Retention purge.
   *
   * These rows name clients, so they fall under the same retention question as
   * everything else holding personal data — and the permanent record of an
   * assignment is the audit log, not the reminder that it happened.
   *
   * Read notifications are purged after the window; unread ones are kept
   * regardless of age, because deleting something a person has never seen is
   * how a notification centre quietly loses the one item that mattered.
   */
  async purgeOld(now: Date = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff }, readAt: { not: null } },
    });
    return { deleted: count };
  }

  private toView(row: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: Date | null;
    createdAt: Date;
    actor: { firstName: string; lastName: string } | null;
  }): NotificationView {
    return {
      id: row.id,
      type: row.type as NotificationType,
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
