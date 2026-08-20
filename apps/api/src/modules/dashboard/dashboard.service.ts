import { Injectable } from '@nestjs/common';

import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { decimalToString } from '../leads/lead.mapper';

const DAY_MS = 86_400_000;

/**
 * Dashboard aggregates.
 *
 * Every query composes the caller's ABAC filter, so the same endpoint serves an
 * executive and a sales executive and each sees only their own slice. Building
 * separate per-role endpoints would mean maintaining the scope logic in seven
 * places and getting it wrong in at least one.
 *
 * These are live aggregate queries. That is correct at SIHL's current volume
 * and wrong above roughly a million leads, at which point these move to a
 * nightly-refreshed materialised view — see docs/01-architecture/scaling.md.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async overview(user: AuthenticatedPrincipal) {
    const leadScope = this.scope.leadScope(user);
    const customerScope = this.scope.customerScope(user);
    const taskScope = this.scope.taskScope(user);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last30 = new Date(now.getTime() - 30 * DAY_MS);
    const previous30 = new Date(now.getTime() - 60 * DAY_MS);

    // Cast once here rather than at a dozen call sites: ScopeService returns a
    // model-agnostic fragment so the same code can filter leads, customers and
    // tasks, and Prisma's per-model input types cannot express that.
    const leadWhere = { deletedAt: null, AND: [leadScope] } as Prisma.LeadWhereInput;
    const customerWhere = { deletedAt: null, AND: [customerScope] } as Prisma.CustomerWhereInput;

    const [
      totalLeads,
      newToday,
      openLeads,
      cohortConvertedLast30,
      cohortConvertedPrevious30,
      createdLast30,
      createdPrevious30,
      overdueFollowUps,
      unassigned,
      pipelineValue,
      hotLeads,
      totalCustomers,
      onboardingCustomers,
      activatedLast30,
      openTasks,
      overdueTasks,
    ] = await this.prisma.$transaction([
      this.prisma.lead.count({ where: leadWhere }),
      this.prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: startOfToday } } }),
      this.prisma.lead.count({
        where: { ...leadWhere, status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
      }),
      // Cohort conversion, not window conversion.
      //
      // Counting "leads converted in the last 30 days" against "leads created
      // in the last 30 days" compares two different populations — most of the
      // numerator was created before the window opened, so the rate can exceed
      // anything sensible and moves for reasons nobody can explain. Both sides
      // below are the same cohort: leads *created* in the window, and how many
      // of those have since converted.
      this.prisma.lead.count({
        where: { ...leadWhere, createdAt: { gte: last30 }, convertedAt: { not: null } },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          createdAt: { gte: previous30, lt: last30 },
          convertedAt: { not: null },
        },
      }),
      this.prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: last30 } } }),
      this.prisma.lead.count({
        where: { ...leadWhere, createdAt: { gte: previous30, lt: last30 } },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          nextFollowUpAt: { lt: now },
          status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
        },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          ownerId: null,
          status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
        },
      }),
      this.prisma.lead.aggregate({
        where: { ...leadWhere, status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
        _sum: { estimatedValue: true },
      }),
      this.prisma.lead.count({
        where: {
          ...leadWhere,
          score: { gte: 70 },
          status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
        },
      }),
      this.prisma.customer.count({ where: customerWhere }),
      this.prisma.customer.count({ where: { ...customerWhere, status: 'ONBOARDING' } }),
      this.prisma.customer.count({ where: { ...customerWhere, activatedAt: { gte: last30 } } }),
      this.prisma.task.count({
        where: { deletedAt: null, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } }, AND: [taskScope] },
      }),
      this.prisma.task.count({
        where: {
          deletedAt: null,
          statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
          dueAt: { lt: now },
          AND: [taskScope],
        },
      }),
    ]);

    // The two breakdowns sit outside the transaction above: they are chart
    // series rather than figures that have to agree with each other to the row,
    // and grouping inside `$transaction([...])` widens the tuple type enough
    // that `_count` stops being inferable as a number.
    const [byStatus, bySource] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: leadWhere,
        _count: { _all: true },
        orderBy: { source: 'asc' },
      }),
    ]);

    // Both ratios are cohort rates (see the comment on the counts above), so
    // the delta between them compares like with like.
    const conversionRate = createdLast30 > 0 ? (cohortConvertedLast30 / createdLast30) * 100 : 0;
    const previousConversionRate =
      createdPrevious30 > 0 ? (cohortConvertedPrevious30 / createdPrevious30) * 100 : 0;

    return {
      leads: {
        total: totalLeads,
        newToday,
        open: openLeads,
        hot: hotLeads,
        unassigned,
        overdueFollowUps,
        createdLast30,
        convertedLast30: cohortConvertedLast30,
        pipelineValue: decimalToString(pipelineValue._sum.estimatedValue) ?? '0',
        conversionRate: Number(conversionRate.toFixed(1)),
        conversionRateDelta: Number((conversionRate - previousConversionRate).toFixed(1)),
        createdDeltaPercent:
          createdPrevious30 > 0
            ? Number((((createdLast30 - createdPrevious30) / createdPrevious30) * 100).toFixed(1))
            : null,
        byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
        bySource: bySource
          .map((row) => ({ source: row.source, count: row._count._all }))
          .sort((a, b) => b.count - a.count),
      },
      customers: {
        total: totalCustomers,
        onboarding: onboardingCustomers,
        activatedLast30,
      },
      tasks: { open: openTasks, overdue: overdueTasks },
    };
  }

  /**
   * Lead volume per day for the last N days, zero-filled.
   *
   * Zero-filling in the API rather than the chart component means every client
   * (web, mobile, an export) gets a continuous series, and a day with no leads
   * renders as a gap at zero rather than being silently skipped — which would
   * make a bad week look like a normal one with fewer points.
   */
  async leadTrend(user: AuthenticatedPrincipal, days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await this.prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since }, AND: [this.scope.leadScope(user)] },
      select: { createdAt: true, convertedAt: true },
    });

    const buckets = new Map<string, { created: number; converted: number }>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = new Date(Date.now() - index * DAY_MS);
      buckets.set(day.toISOString().slice(0, 10), { created: 0, converted: 0 });
    }

    for (const row of rows) {
      const createdKey = row.createdAt.toISOString().slice(0, 10);
      const createdBucket = buckets.get(createdKey);
      if (createdBucket) createdBucket.created += 1;

      if (row.convertedAt) {
        const convertedKey = row.convertedAt.toISOString().slice(0, 10);
        const convertedBucket = buckets.get(convertedKey);
        if (convertedBucket) convertedBucket.converted += 1;
      }
    }

    return [...buckets.entries()].map(([date, counts]) => ({ date, ...counts }));
  }

  /** Leaderboard. Restricted to callers with a team-or-wider scope by the guard. */
  async topPerformers(user: AuthenticatedPrincipal, limit = 5) {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const grouped = await this.prisma.lead.groupBy({
      by: ['ownerId'],
      where: {
        deletedAt: null,
        convertedAt: { gte: since },
        ownerId: { not: null },
        AND: [this.scope.leadScope(user)],
      },
      _count: { _all: true },
      orderBy: { _count: { ownerId: 'desc' } },
      take: limit,
    });

    const owners = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((row) => row.ownerId!).filter(Boolean) } },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true },
    });
    const byId = new Map(owners.map((owner) => [owner.id, owner]));

    return grouped.map((row) => {
      const owner = byId.get(row.ownerId!);
      return {
        userId: row.ownerId,
        fullName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : 'Unknown',
        avatarUrl: owner?.avatarUrl ?? null,
        conversions: row._count._all,
      };
    });
  }
}
