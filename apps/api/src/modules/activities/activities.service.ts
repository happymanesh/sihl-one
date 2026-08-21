import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { checkMeetingLink, type ActivityQuery, type CreateActivityInput } from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { ScopeService } from '../../common/scope.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { rescore } from '../leads/lead.mapper';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: ActivityQuery,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    // An activity is only readable if its parent is. Checking the parent rather
    // than the activity is what stops a scoped user reading the call notes of a
    // lead they cannot see by passing its id directly.
    if (query.entityType && query.entityId) {
      await this.assertParentVisible(user, query.entityType, query.entityId);
    }

    const where: Record<string, unknown> = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.type) where.type = query.type;
    if (query.actorId) where.actorId = query.actorId;
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    // Without a parent, a caller may only see activities they performed
    // themselves — otherwise `GET /activities` is an unscoped firehose.
    if (!query.entityId && user.dataScope !== 'ALL') {
      where.actorId = user.id;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({
        where,
        orderBy: { occurredAt: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.activity.count({ where }),
    ]);

    return paginate(
      rows.map((activity) => ({
        id: activity.id,
        entityType: activity.entityType,
        entityId: activity.entityId,
        type: activity.type,
        direction: activity.direction,
        subject: activity.subject,
        body: activity.body,
        outcome: activity.outcome,
        durationMinutes: activity.durationMinutes,
        occurredAt: activity.occurredAt.toISOString(),
        isSystemGenerated: activity.isSystemGenerated,
        actor: activity.actor
          ? {
              id: activity.actor.id,
              fullName: `${activity.actor.firstName} ${activity.actor.lastName}`.trim(),
            }
          : null,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(user: AuthenticatedPrincipal, input: CreateActivityInput) {
    await this.assertParentVisible(user, input.entityType, input.entityId);

    // Re-checked here, not only in the schema. This URL is sent to clients from
    // SIHL's sender identity, and anything enforced solely at the edge is
    // enforced nowhere — a direct API call would bypass it entirely.
    if (input.meetingLink) {
      const verdict = checkMeetingLink(input.meetingLink);
      if (!verdict.allowed) {
        throw new BadRequestException({ title: 'Meeting link not allowed', detail: verdict.reason });
      }
    }

    if (input.meetingMode) {
      const mode = await this.prisma.meetingModeMaster.findUnique({
        where: { code: input.meetingMode },
        select: { isActive: true, requiresLink: true, label: true },
      });
      if (!mode) {
        throw new BadRequestException({ title: 'Unknown meeting mode' });
      }
      if (!mode.isActive) {
        throw new BadRequestException({
          title: 'That mode is no longer available',
          detail: `"${mode.label}" has been switched off.`,
        });
      }
      if (mode.requiresLink && !input.meetingLink) {
        throw new BadRequestException({
          title: 'A meeting link is needed',
          detail: `"${mode.label}" is an online meeting — paste the link so it can be shared with the client.`,
        });
      }
    }

    const activity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.activity.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          type: input.type,
          direction: input.direction,
          subject: input.subject,
          body: input.body ?? null,
          outcome: input.outcome ?? null,
          durationMinutes: input.durationMinutes ?? null,
          occurredAt: input.occurredAt ?? new Date(),
          meetingMode: input.meetingMode ?? null,
          meetingLink: input.meetingLink ?? null,
          actorId: user.id,
        },
      });

      // Logging an interaction moves the parent's recency clock, and for a lead
      // it also changes the score — a lead that was just spoken to is a
      // different prospect from one that has been silent for a month.
      if (input.entityType === 'LEAD') {
        await tx.lead.update({
          where: { id: input.entityId },
          data: {
            lastActivityAt: created.occurredAt,
            nextFollowUpAt: input.nextFollowUpAt ?? undefined,
          },
        });
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: input.entityId } });
        const activityCount = await tx.activity.count({
          where: { entityType: 'LEAD', entityId: input.entityId, isSystemGenerated: false },
        });
        await tx.lead.update({
          where: { id: input.entityId },
          data: rescore(lead, activityCount) as never,
        });
      } else if (input.entityType === 'CUSTOMER') {
        await tx.customer.update({
          where: { id: input.entityId },
          data: { lastActivityAt: created.occurredAt },
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'activity',
      resourceId: activity.id,
      changes: { entityType: input.entityType, entityId: input.entityId, type: input.type },
    });

    return {
      id: activity.id,
      type: activity.type,
      subject: activity.subject,
      occurredAt: activity.occurredAt.toISOString(),
    };
  }

  private async assertParentVisible(
    user: AuthenticatedPrincipal,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    let visible = false;

    switch (entityType) {
      case 'LEAD':
        visible = Boolean(
          await this.prisma.lead.findFirst({
            where: { id: entityId, deletedAt: null, AND: [this.scope.leadScope(user)] },
            select: { id: true },
          }),
        );
        break;
      case 'CUSTOMER':
        visible = Boolean(
          await this.prisma.customer.findFirst({
            where: { id: entityId, deletedAt: null, AND: [this.scope.customerScope(user)] },
            select: { id: true },
          }),
        );
        break;
      case 'PARTNER':
        visible =
          user.dataScope === 'ALL' || user.partnerId === entityId;
        break;
      default:
        visible = user.dataScope === 'ALL';
    }

    if (!visible) {
      throw new ForbiddenException({
        title: 'Record not accessible',
        detail: 'You cannot log or read activity against a record outside your data scope.',
      });
    }
  }
}
