import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OffboardPreview, OffboardUserInput } from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentService } from '../assignment/assignment.service';

/**
 * Offboarding a salesperson.
 *
 * The order of operations is the whole design. Sessions are revoked **before**
 * anything is reassigned, because a departing rep with a live session and a
 * visible book is the single most common data-loss event in a broking business.
 * Reassigning first would leave a window in which they can see exactly which of
 * their relationships is moving where.
 *
 * Closed work stays with them. Only live work moves — reassigning a lead they
 * converted two years ago would rewrite history and corrupt every attribution
 * and performance figure derived from it.
 */
@Injectable()
export class OffboardingService {
  private readonly logger = new Logger(OffboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: AssignmentService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async preview(userId: string): Promise<OffboardPreview> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, status: true },
    });
    if (!user) throw new NotFoundException({ title: 'User not found' });

    const [openLeads, closedLeads, customers, openTasks, plannedVisits, activeSessions] =
      await this.prisma.$transaction([
        this.prisma.lead.count({
          where: {
            ownerId: userId,
            deletedAt: null,
            status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
          },
        }),
        this.prisma.lead.count({
          where: {
            ownerId: userId,
            deletedAt: null,
            status: { in: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
          },
        }),
        this.prisma.customer.count({
          where: { relationshipManagerId: userId, deletedAt: null },
        }),
        this.prisma.task.count({
          where: { assigneeId: userId, deletedAt: null, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } },
        }),
        this.prisma.visit.count({ where: { userId, status: { in: ['PLANNED', 'CHECKED_IN'] } } }),
        this.prisma.session.count({
          where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
      ]);

    return {
      user: {
        id: user.id,
        fullName: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        status: user.status,
      },
      holdings: { openLeads, closedLeads, customers, openTasks, plannedVisits, activeSessions },
      // Closed leads are deliberately absent: they stay put.
      willReassign: {
        leads: openLeads,
        customers,
        tasks: openTasks,
        visits: plannedVisits,
      },
    };
  }

  /**
   * Flags someone as being in their notice period.
   *
   * Purely a monitoring signal — it changes no permission. The value is that
   * every bulk export and large read by this person is now audited at an
   * elevated level, which is what makes an unusual data pull visible while
   * they are still employed and still entitled to do their job.
   */
  async markNoticePeriod(actor: AuthenticatedPrincipal, userId: string, from: Date) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { noticePeriodFrom: from },
      select: { id: true, firstName: true, lastName: true, noticePeriodFrom: true },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'user.notice_period',
      resourceId: userId,
      changes: { noticePeriodFrom: from.toISOString() },
      reason: 'Elevated export monitoring enabled',
    });

    this.logger.warn(
      `${user.firstName} ${user.lastName} marked as in notice from ${from.toISOString()}; ` +
        'exports by this user will be audited at an elevated level.',
    );

    return {
      id: user.id,
      noticePeriodFrom: user.noticePeriodFrom?.toISOString() ?? null,
    };
  }

  async offboard(actor: AuthenticatedPrincipal, userId: string, input: OffboardUserInput) {
    if (userId === actor.id) {
      throw new BadRequestException({
        title: 'You cannot offboard yourself',
        detail: 'Ask another administrator to do this.',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!user) throw new NotFoundException({ title: 'User not found' });

    await this.assertRecipientsAreActive(input.targetUserIds, userId);

    // --- Step 1: cut access, before anything moves -------------------------
    const revoked = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'OFFBOARDED' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'DISABLED', offboardedAt: new Date() },
    });

    this.logger.log(
      `Offboarding ${user.email}: revoked ${revoked.count} session(s) before reassignment.`,
    );

    // --- Step 2: move live work -------------------------------------------
    const openLeads = await this.prisma.lead.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: {
        id: true,
        source: true,
        productInterest: true,
        city: true,
        state: true,
        score: true,
        campaignId: true,
      },
    });

    let leadsMoved = 0;
    let cursor = 0;

    for (const lead of openLeads) {
      const newOwnerId = await this.pickRecipient(input, lead, cursor);
      cursor += 1;

      const owner = newOwnerId
        ? await this.prisma.user.findUnique({
            where: { id: newOwnerId },
            select: { orgUnitId: true, firstName: true, lastName: true },
          })
        : null;

      await this.prisma.$transaction(async (tx) => {
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            ownerId: newOwnerId,
            orgUnitId: owner?.orgUnitId ?? undefined,
            updatedById: actor.id,
          },
        });

        // The handover goes on the timeline. A lead that silently changes hands
        // leaves the next person with no idea why they have it.
        await tx.activity.create({
          data: {
            entityType: 'LEAD',
            entityId: lead.id,
            type: 'ASSIGNMENT',
            direction: 'INTERNAL',
            subject: newOwnerId
              ? `Reassigned from ${user.firstName} ${user.lastName} to ${owner?.firstName} ${owner?.lastName}`
              : `Unassigned — ${user.firstName} ${user.lastName} left the organisation`,
            body: input.reason,
            actorId: actor.id,
            isSystemGenerated: true,
          },
        });
      });

      leadsMoved += 1;
    }

    // --- Step 3: customers, tasks, planned visits --------------------------
    let customersMoved = 0;
    if (input.includeCustomers) {
      const fallbackOwner = await this.pickRecipient(input, null, cursor);
      if (fallbackOwner) {
        const result = await this.prisma.customer.updateMany({
          where: { relationshipManagerId: userId, deletedAt: null },
          data: { relationshipManagerId: fallbackOwner, updatedById: actor.id },
        });
        customersMoved = result.count;
      }
    }

    let tasksMoved = 0;
    if (input.includeTasks) {
      const fallbackOwner = await this.pickRecipient(input, null, cursor + 1);
      if (fallbackOwner) {
        const result = await this.prisma.task.updateMany({
          where: { assigneeId: userId, deletedAt: null, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } },
          data: { assigneeId: fallbackOwner },
        });
        tasksMoved = result.count;
      }
    }

    // Planned visits are cancelled rather than reassigned: a visit is a
    // commitment by a specific person to be somewhere, and handing it to a
    // colleague who has never spoken to the customer is not a handover.
    const cancelledVisits = await this.prisma.visit.updateMany({
      where: { userId, status: 'PLANNED' },
      data: { status: 'CANCELLED', meetingNotes: `Cancelled — ${input.reason}` },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'user.offboard',
      resourceId: userId,
      changes: {
        strategy: input.strategy,
        sessionsRevoked: revoked.count,
        leadsMoved,
        customersMoved,
        tasksMoved,
        visitsCancelled: cancelledVisits.count,
      },
      reason: input.reason,
    });

    await this.outbox.publish(this.prisma, {
      aggregateType: 'user',
      aggregateId: userId,
      eventType: 'user.offboarded',
      payload: {
        email: user.email,
        strategy: input.strategy,
        leadsMoved,
        customersMoved,
        sessionsRevoked: revoked.count,
        successorId: input.strategy === 'SINGLE_OWNER' ? (input.targetUserIds[0] ?? null) : null,
        summary: `${leadsMoved} leads and ${customersMoved} customers`,
        actorId: actor.id,
      },
    });

    return {
      userId,
      sessionsRevoked: revoked.count,
      leadsMoved,
      customersMoved,
      tasksMoved,
      visitsCancelled: cancelledVisits.count,
    };
  }

  // -------------------------------------------------------------------------

  private async pickRecipient(
    input: OffboardUserInput,
    lead: {
      source: string;
      productInterest: string[];
      city: string | null;
      state: string | null;
      score: number;
      campaignId: string | null;
    } | null,
    cursor: number,
  ): Promise<string | null> {
    switch (input.strategy) {
      case 'UNASSIGN':
        return null;

      case 'SINGLE_OWNER':
        return input.targetUserIds[0] ?? null;

      case 'ROUND_ROBIN':
        return input.targetUserIds.length
          ? input.targetUserIds[cursor % input.targetUserIds.length]!
          : null;

      case 'RULES_ENGINE': {
        if (!lead) return null;
        const routed = await this.assignment.resolveOwner({
          source: lead.source,
          productInterest: lead.productInterest,
          city: lead.city,
          state: lead.state,
          score: lead.score,
          campaignId: lead.campaignId,
        });
        return routed.ownerId;
      }

      default:
        return null;
    }
  }

  private async assertRecipientsAreActive(
    userIds: readonly string[],
    departingUserId: string,
  ): Promise<void> {
    if (userIds.length === 0) return;

    if (userIds.includes(departingUserId)) {
      throw new BadRequestException({
        title: 'Cannot hand work back to the departing user',
      });
    }

    const active = await this.prisma.user.count({
      where: { id: { in: [...userIds] }, status: 'ACTIVE', deletedAt: null },
    });

    if (active !== userIds.length) {
      throw new BadRequestException({
        title: 'Recipient is not active',
        detail: 'Work can only be handed to active users.',
      });
    }
  }
}
