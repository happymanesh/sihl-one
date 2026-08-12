import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  coachingNudges,
  computeRating,
  type BehaviourInputs,
  type RatedLead,
  type Scorecard,
  type UpsertTargetInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { decimalToString } from '../leads/lead.mapper';

const HOUR_MS = 3_600_000;

/**
 * Sales performance.
 *
 * This service only gathers facts. Every judgement — what "good" means, how
 * much a small sample should be discounted, what to coach — lives in the pure
 * functions in `@sihl-one/contracts/performance`, where it is exhaustively
 * tested and can be reviewed by someone who does not read NestJS.
 *
 * That split matters more here than elsewhere: this rating will be read as an
 * assessment of a person's work, so the logic behind it has to be inspectable.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async scorecard(
    actor: AuthenticatedPrincipal,
    userId: string,
    days = 90,
  ): Promise<Scorecard> {
    // A rep may see their own card. A manager may see their team's. Nobody
    // sees a peer's — a rating is personnel information, not a leaderboard.
    if (userId !== actor.id) {
      const visible =
        actor.dataScope === 'ALL' || actor.teamUserIds.includes(userId);
      if (!visible) {
        throw new ForbiddenException({
          title: 'Not your team',
          detail: 'You can only view scorecards for yourself and people reporting to you.',
        });
      }
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundException({ title: 'User not found' });

    const from = new Date(Date.now() - days * 86_400_000);
    const rating = await this.ratingFor(userId, from);

    const [target, standing] = await Promise.all([
      this.targetFor(userId),
      this.standingFor(actor, userId, rating.overall, from),
    ]);

    if (userId !== actor.id) {
      await this.audit.record({
        action: 'READ',
        resource: 'performance.scorecard',
        resourceId: userId,
      });
    }

    return {
      user: { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim() },
      period: {
        label: `Last ${days} days`,
        from: from.toISOString(),
        to: new Date().toISOString(),
      },
      rating,
      nudges: coachingNudges(rating),
      target,
      standing,
    };
  }

  async upsertTarget(actor: AuthenticatedPrincipal, input: UpsertTargetInput) {
    if (input.userId !== actor.id && actor.dataScope !== 'ALL') {
      if (!actor.teamUserIds.includes(input.userId)) {
        throw new ForbiddenException({ title: 'Not your team' });
      }
    }

    const target = await this.prisma.salesTarget.upsert({
      where: {
        userId_period_periodStart: {
          userId: input.userId,
          period: input.period,
          periodStart: input.periodStart,
        },
      },
      update: {
        conversionTarget: input.conversionTarget ?? null,
        valueTarget: input.valueTarget ?? null,
        setById: actor.id,
      },
      create: {
        userId: input.userId,
        period: input.period,
        periodStart: input.periodStart,
        conversionTarget: input.conversionTarget ?? null,
        valueTarget: input.valueTarget ?? null,
        setById: actor.id,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'sales_target',
      resourceId: target.id,
      changes: {
        userId: input.userId,
        period: input.period,
        conversionTarget: input.conversionTarget,
        valueTarget: input.valueTarget,
      },
    });

    return target;
  }

  /**
   * Ratings for several people at once, for the allocation engine.
   *
   * Sequential rather than parallel: each rating is four queries, and a team of
   * fifty fired at once is how a connection pool gets exhausted by a screen
   * nobody considered expensive.
   */
  async ratingsFor(
    userIds: readonly string[],
    from: Date,
  ): Promise<Map<string, Awaited<ReturnType<PerformanceService['ratingFor']>>>> {
    const ratings = new Map<string, Awaited<ReturnType<PerformanceService['ratingFor']>>>();
    for (const userId of userIds) {
      ratings.set(userId, await this.ratingFor(userId, from));
    }
    return ratings;
  }

  // -------------------------------------------------------------------------

  /**
   * Gathers one person's leads and habits, then hands both to the pure rater.
   *
   * `score` is read as the lead's *current* score, which is an approximation of
   * its score at assignment — the two diverge as a lead is worked. Storing the
   * score at assignment is the correct fix and is noted in the module doc; it
   * needs a column and a backfill, so it is deliberately not faked here.
   */
  private async ratingFor(userId: string, from: Date) {
    const leads = await this.prisma.lead.findMany({
      where: { ownerId: userId, deletedAt: null, createdAt: { gte: from } },
      select: {
        id: true,
        score: true,
        status: true,
        convertedAt: true,
        createdAt: true,
        nextFollowUpAt: true,
        lostReason: true,
      },
    });

    const rated: RatedLead[] = leads.map((lead) => ({
      scoreAtAssignment: lead.score,
      converted: lead.convertedAt !== null,
    }));

    const leadIds = leads.map((lead) => lead.id);
    const openLeads = leads.filter(
      (lead) => !['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(lead.status),
    );
    const lostLeads = leads.filter((lead) => lead.status === 'LOST');

    // First human interaction per lead. System-generated rows are excluded —
    // a status change is not a response to a customer.
    const firstContacts = await this.prisma.activity.findMany({
      where: {
        entityType: 'LEAD',
        entityId: { in: leadIds.length ? leadIds : ['none'] },
        isSystemGenerated: false,
      },
      select: { entityId: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });

    const firstByLead = new Map<string, Date>();
    for (const activity of firstContacts) {
      if (!firstByLead.has(activity.entityId)) {
        firstByLead.set(activity.entityId, activity.occurredAt);
      }
    }

    const responseHours = leads
      .filter((lead) => firstByLead.has(lead.id))
      .map(
        (lead) =>
          (firstByLead.get(lead.id)!.getTime() - lead.createdAt.getTime()) / HOUR_MS,
      )
      .filter((hours) => hours >= 0)
      .sort((a, b) => a - b);

    // Median, not mean: one lead contacted three weeks late would otherwise
    // drag an entire quarter's figure and make it unactionable.
    const medianFirstResponseHours =
      responseHours.length > 0
        ? responseHours[Math.floor(responseHours.length / 2)]!
        : null;

    const now = new Date();
    const behaviour: BehaviourInputs = {
      medianFirstResponseHours,
      followUpCoverage:
        openLeads.length === 0
          ? 1
          : openLeads.filter((lead) => lead.nextFollowUpAt !== null).length / openLeads.length,
      overdueRate:
        openLeads.length === 0
          ? 0
          : openLeads.filter((lead) => lead.nextFollowUpAt && lead.nextFollowUpAt < now).length /
            openLeads.length,
      activitiesPerLead: leads.length === 0 ? 0 : firstContacts.length / leads.length,
      lostReasonCoverage:
        lostLeads.length === 0
          ? 1
          : lostLeads.filter((lead) => lead.lostReason !== null).length / lostLeads.length,
    };

    const achieved = await this.prisma.lead.aggregate({
      where: { ownerId: userId, deletedAt: null, convertedAt: { gte: from } },
      _sum: { estimatedValue: true },
    });

    const target = await this.currentTarget(userId);

    return computeRating({
      leads: rated,
      behaviour,
      achievedValue: achieved._sum.estimatedValue ? Number(achieved._sum.estimatedValue) : 0,
      targetValue: target?.valueTarget ? Number(target.valueTarget) : null,
    });
  }

  /** The most recent target whose period has started. */
  private async currentTarget(userId: string) {
    return this.prisma.salesTarget.findFirst({
      where: { userId, periodStart: { lte: new Date() } },
      orderBy: { periodStart: 'desc' },
    });
  }

  private async targetFor(userId: string): Promise<Scorecard['target']> {
    const target = await this.currentTarget(userId);
    if (!target) return null;

    const [conversions, value] = await this.prisma.$transaction([
      this.prisma.lead.count({
        where: { ownerId: userId, deletedAt: null, convertedAt: { gte: target.periodStart } },
      }),
      this.prisma.lead.aggregate({
        where: { ownerId: userId, deletedAt: null, convertedAt: { gte: target.periodStart } },
        _sum: { estimatedValue: true },
      }),
    ]);

    // Where they should be by now if pacing evenly. Comparing attainment
    // against 100% halfway through a quarter is how a rep on track is told
    // they are behind.
    const periodDays = target.period === 'MONTH' ? 30 : target.period === 'QUARTER' ? 91 : 365;
    const elapsed = (Date.now() - target.periodStart.getTime()) / 86_400_000;
    const expectedPacePercent = Math.round(
      Math.max(0, Math.min(100, (elapsed / periodDays) * 100)),
    );

    return {
      conversionTarget: target.conversionTarget,
      valueTarget: decimalToString(target.valueTarget),
      achievedConversions: conversions,
      achievedValue: decimalToString(value._sum.estimatedValue) ?? '0',
      expectedPacePercent,
    };
  }

  /**
   * Where this person sits relative to their peers.
   *
   * A percentile band and the top score, never a ranked list of names. An
   * explicit leaderboard position demotivates everyone below the median and
   * tells them nothing they can act on; the gap to the top gives the same
   * information without publishing a queue.
   *
   * The peer set is the *subject's* team — the people reporting to the same
   * manager, or failing that their branch — and deliberately not the caller's
   * data scope. A sales executive has SELF scope, so scoping this the usual way
   * gave them a comparison against nobody, which is exactly the question they
   * asked the screen. Nothing identifying crosses that boundary: the return is
   * three aggregate numbers and no names, which is why widening the peer set
   * here is not a scope leak.
   */
  private async standingFor(
    _actor: AuthenticatedPrincipal,
    userId: string,
    overall: number,
    from: Date,
  ): Promise<Scorecard['standing']> {
    const subject = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true, orgUnitId: true },
    });

    const peerFilter = subject?.managerId
      ? { managerId: subject.managerId }
      : subject?.orgUnitId
        ? { orgUnitId: subject.orgUnitId }
        : null;

    const peers = peerFilter
      ? await this.prisma.user.findMany({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            userType: 'INTERNAL',
            id: { not: userId },
            ...peerFilter,
          },
          select: { id: true },
          take: 50,
        })
      : [];

    if (peers.length === 0) {
      return {
        percentile: null,
        teamMedianOverall: null,
        topPerformerOverall: null,
        peersAssessed: 0,
      };
    }

    const scores = await Promise.all(
      peers.map(async (peer) => (await this.ratingFor(peer.id, from)).overall),
    );
    const sorted = [...scores].sort((a, b) => a - b);

    const below = sorted.filter((score) => score < overall).length;

    return {
      percentile: Math.round((below / sorted.length) * 100),
      teamMedianOverall: sorted[Math.floor(sorted.length / 2)] ?? null,
      topPerformerOverall: sorted[sorted.length - 1] ?? null,
      peersAssessed: sorted.length,
    };
  }
}
