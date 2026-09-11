import { Injectable } from '@nestjs/common';
import {
  DEFAULT_REPORT_DAYS,
  rate,
  type BranchReportRow,
  type OwnerReportRow,
  type ProductReportRow,
  type ReportPeriod,
  type ReportRange,
  type ReportSummary,
  type SalesReport,
  type SourceReportRow,
  type StatusReportRow,
} from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';

/** The three a lead does not come back from without being reopened. */
const CLOSED = ['CONVERTED', 'LOST', 'DISQUALIFIED'] as const;

/**
 * Sales reporting.
 *
 * One rule runs through every query here: the caller's data scope is applied
 * before anything is counted. A sales executive calling `byOwner` sees one row
 * — themselves. A branch manager sees their branch. The national head sees
 * everyone. That is what allows a single set of endpoints to serve the whole
 * hierarchy rather than a report per rank, and it is why none of these methods
 * takes a "whose data" argument: there is nothing to pass, because the answer
 * is already in the principal.
 *
 * Consistent with ADR-0002, every value figure is a rep-entered estimate. None
 * of it is brokerage or booked revenue, and it must never be reconciled against
 * the back office.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Resolves the window once, so every section of a report covers exactly the
   * same period. Computing it per-section would let a report generated across
   * midnight disagree with itself.
   */
  period(range: ReportRange): { from: Date; to: Date; view: ReportPeriod } {
    const to = range.to ?? new Date();
    const from = range.from ?? new Date(to.getTime() - DEFAULT_REPORT_DAYS * 86_400_000);
    return {
      from,
      to,
      view: {
        from: from.toISOString(),
        to: to.toISOString(),
        days: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
      },
    };
  }

  /** Leads the caller may see at all — the basis of every count below. */
  private scoped(user: AuthenticatedPrincipal) {
    return { deletedAt: null, AND: [this.scope.leadScope(user)] };
  }

  async summary(user: AuthenticatedPrincipal, range: ReportRange): Promise<ReportSummary> {
    const { from, to, view } = this.period(range);
    const base = this.scoped(user);
    const created = { gte: from, lte: to };

    const [leadsCreated, leadsConverted, leadsLost, openLeads, unassigned, overdue, value] =
      await Promise.all([
        this.prisma.lead.count({ where: { ...base, createdAt: created } }),
        // Converted *in* the window, whenever the lead was created. Credit
        // belongs to when the work landed, not when the lead arrived.
        this.prisma.lead.count({ where: { ...base, convertedAt: created } }),
        this.prisma.lead.count({ where: { ...base, status: 'LOST', updatedAt: created } }),
        this.prisma.lead.count({ where: { ...base, status: { notIn: [...CLOSED] } } }),
        this.prisma.lead.count({ where: { ...base, ownerId: null, status: { notIn: [...CLOSED] } } }),
        this.prisma.lead.count({
          where: { ...base, status: { notIn: [...CLOSED] }, nextFollowUpAt: { lt: new Date() } },
        }),
        this.prisma.lead.aggregate({
          where: { ...base, status: { notIn: [...CLOSED] } },
          _sum: { estimatedValue: true },
        }),
      ]);

    const leadIds = await this.leadIdsInScope(user);
    const [activities, visits, peopleInScope] = await Promise.all([
      this.prisma.activity.count({
        where: {
          entityType: 'LEAD',
          entityId: { in: leadIds },
          createdAt: created,
          // The same filter the scoring path uses. Without it a status change
          // the system wrote counts as the rep having contacted somebody.
          isSystemGenerated: false,
        },
      }),
      this.prisma.visit.count({
        where: { entityType: 'LEAD', entityId: { in: leadIds }, checkInAt: created },
      }),
      this.peopleInScope(user),
    ]);

    return {
      period: view,
      leadsCreated,
      leadsConverted,
      leadsLost,
      openLeads,
      conversionRate: rate(leadsConverted, leadsCreated),
      pipelineValue: (value._sum.estimatedValue ?? 0).toString(),
      activities,
      visits,
      overdueFollowUps: overdue,
      unassigned,
      peopleInScope,
    };
  }

  /**
   * Resource-wise: one row per person, plus an "Unassigned" row.
   *
   * Unassigned leads are shown rather than dropped. They are nobody's number,
   * which is exactly why they go unworked, and a report that silently omits
   * them hides the one column a sales head can act on immediately.
   */
  async byOwner(user: AuthenticatedPrincipal, range: ReportRange): Promise<OwnerReportRow[]> {
    const { from, to } = this.period(range);
    const base = this.scoped(user);
    const created = { gte: from, lte: to };

    const [assigned, converted, lost, open, value] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['ownerId'], where: { ...base, createdAt: created }, _count: true }),
      this.prisma.lead.groupBy({ by: ['ownerId'], where: { ...base, convertedAt: created }, _count: true }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { ...base, status: 'LOST', updatedAt: created },
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { ...base, status: { notIn: [...CLOSED] } },
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { ...base, status: { notIn: [...CLOSED] } },
        _sum: { estimatedValue: true },
      }),
    ]);

    const overdue = await this.prisma.lead.groupBy({
      by: ['ownerId'],
      where: {
        ...base,
        status: { notIn: [...CLOSED] },
        nextFollowUpAt: { lt: new Date() },
      },
      _count: true,
    });

    const ownerIds = [
      ...new Set(
        [...assigned, ...converted, ...lost, ...open]
          .map((r) => r.ownerId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const people = await this.prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        orgUnit: { select: { name: true } },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));

    const activityByOwner = await this.activityCountsByOwner(user, from, to);
    const visitByOwner = await this.visitCountsByOwner(user, from, to);

    const count = (rows: Array<{ ownerId: string | null; _count: number }>, id: string | null) =>
      rows.find((r) => r.ownerId === id)?._count ?? 0;

    const ids: Array<string | null> = [...ownerIds];
    if ([...assigned, ...open].some((r) => r.ownerId === null)) ids.push(null);

    return ids
      .map((id): OwnerReportRow => {
        const person = id ? byId.get(id) : undefined;
        const assignedCount = count(assigned, id);
        const convertedCount = count(converted, id);
        return {
          ownerId: id,
          ownerName: person ? `${person.firstName} ${person.lastName}` : 'Unassigned',
          employeeCode: person?.employeeCode ?? null,
          branch: person?.orgUnit?.name ?? null,
          assigned: assignedCount,
          open: count(open, id),
          converted: convertedCount,
          lost: count(lost, id),
          conversionRate: rate(convertedCount, assignedCount),
          activities: id ? (activityByOwner.get(id) ?? 0) : 0,
          visits: id ? (visitByOwner.get(id) ?? 0) : 0,
          overdueFollowUps: count(overdue, id),
          pipelineValue: (
            value.find((r) => r.ownerId === id)?._sum.estimatedValue ?? 0
          ).toString(),
        };
      })
      .sort((a, b) => b.converted - a.converted || b.assigned - a.assigned);
  }

  /**
   * Product-wise, from the per-product outcome table rather than the lead's
   * status. A lead can win equities and lose derivatives; rolling that up to a
   * single lead status would credit or blame both.
   */
  async byProduct(user: AuthenticatedPrincipal, range: ReportRange): Promise<ProductReportRow[]> {
    const { from, to } = this.period(range);
    const leadIds = await this.leadIdsInScope(user);

    const rows = await this.prisma.leadProduct.findMany({
      where: { leadId: { in: leadIds }, createdAt: { gte: from, lte: to } },
      select: { productCode: true, status: true, product: { select: { name: true } } },
    });

    const grouped = new Map<string, ProductReportRow>();
    for (const row of rows) {
      const entry = grouped.get(row.productCode) ?? {
        productCode: row.productCode,
        productName: row.product?.name ?? row.productCode,
        interested: 0,
        open: 0,
        won: 0,
        lost: 0,
        conversionRate: null,
      };
      entry.interested += 1;
      // A lead product carries a LeadStatus, not a separate won/lost vocabulary
      // — `LEAD_PRODUCT_STATUSES = LEAD_STATUSES`. An earlier version of this
      // checked for 'WON', which no status ever equals, so every converted
      // product was silently counted as still open and the won column read zero
      // for everything.
      if (row.status === 'CONVERTED') entry.won += 1;
      else if (row.status === 'LOST' || row.status === 'DISQUALIFIED') entry.lost += 1;
      else entry.open += 1;
      grouped.set(row.productCode, entry);
    }

    return [...grouped.values()]
      .map((row) => ({ ...row, conversionRate: rate(row.won, row.interested) }))
      .sort((a, b) => b.interested - a.interested);
  }

  async bySource(user: AuthenticatedPrincipal, range: ReportRange): Promise<SourceReportRow[]> {
    const { from, to } = this.period(range);
    const base = this.scoped(user);
    const created = { gte: from, lte: to };

    const [leads, converted, lost, value] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['source'], where: { ...base, createdAt: created }, _count: true }),
      this.prisma.lead.groupBy({ by: ['source'], where: { ...base, convertedAt: created }, _count: true }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { ...base, status: 'LOST', updatedAt: created },
        _count: true,
      }),
      this.prisma.lead.groupBy({
        by: ['source'],
        where: { ...base, createdAt: created },
        _sum: { estimatedValue: true },
      }),
    ]);

    return leads
      .map((row): SourceReportRow => {
        const wins = converted.find((c) => c.source === row.source)?._count ?? 0;
        return {
          source: row.source,
          leads: row._count,
          converted: wins,
          lost: lost.find((l) => l.source === row.source)?._count ?? 0,
          conversionRate: rate(wins, row._count),
          pipelineValue: (
            value.find((v) => v.source === row.source)?._sum.estimatedValue ?? 0
          ).toString(),
        };
      })
      .sort((a, b) => b.leads - a.leads);
  }

  /** The funnel: where the whole open book currently sits. */
  async byStatus(user: AuthenticatedPrincipal, range: ReportRange): Promise<StatusReportRow[]> {
    const { from, to } = this.period(range);
    const rows = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { ...this.scoped(user), createdAt: { gte: from, lte: to } },
      _count: true,
    });
    const total = rows.reduce((sum, r) => sum + r._count, 0);
    return rows
      .map((row) => ({
        status: row.status,
        leads: row._count,
        share: rate(row._count, total) ?? 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }

  async byBranch(user: AuthenticatedPrincipal, range: ReportRange): Promise<BranchReportRow[]> {
    const { from, to } = this.period(range);
    const base = this.scoped(user);
    const created = { gte: from, lte: to };

    const [leads, converted, value] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['orgUnitId'], where: { ...base, createdAt: created }, _count: true }),
      this.prisma.lead.groupBy({ by: ['orgUnitId'], where: { ...base, convertedAt: created }, _count: true }),
      this.prisma.lead.groupBy({
        by: ['orgUnitId'],
        where: { ...base, status: { notIn: [...CLOSED] } },
        _sum: { estimatedValue: true },
      }),
    ]);

    const unitIds = leads.map((r) => r.orgUnitId).filter((id): id is string => id !== null);
    const [units, headcount] = await Promise.all([
      this.prisma.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }),
      this.prisma.user.groupBy({
        by: ['orgUnitId'],
        where: { orgUnitId: { in: unitIds }, status: 'ACTIVE' },
        _count: true,
      }),
    ]);
    const nameOf = new Map(units.map((u) => [u.id, u.name]));

    return leads
      .map((row): BranchReportRow => {
        const wins = converted.find((c) => c.orgUnitId === row.orgUnitId)?._count ?? 0;
        return {
          orgUnitId: row.orgUnitId,
          branch: row.orgUnitId ? (nameOf.get(row.orgUnitId) ?? row.orgUnitId) : 'No branch',
          leads: row._count,
          converted: wins,
          conversionRate: rate(wins, row._count),
          people: headcount.find((h) => h.orgUnitId === row.orgUnitId)?._count ?? 0,
          pipelineValue: (
            value.find((v) => v.orgUnitId === row.orgUnitId)?._sum.estimatedValue ?? 0
          ).toString(),
        };
      })
      .sort((a, b) => b.leads - a.leads);
  }

  /** Everything, for the screen and for the workbook, over one shared window. */
  async full(user: AuthenticatedPrincipal, range: ReportRange): Promise<SalesReport> {
    const [summary, byOwner, byProduct, bySource, byStatus, byBranch] = await Promise.all([
      this.summary(user, range),
      this.byOwner(user, range),
      this.byProduct(user, range),
      this.bySource(user, range),
      this.byStatus(user, range),
      this.byBranch(user, range),
    ]);
    return { summary, byOwner, byProduct, bySource, byStatus, byBranch };
  }

  /**
   * Lead ids the caller may see.
   *
   * Activities and visits hang off `entityId` with no scope of their own, so
   * they can only be filtered by first resolving which leads are in scope.
   * Capped: past a few thousand ids the `IN` clause is slower than the query it
   * serves, and a report is not the right place to discover that.
   */
  private async leadIdsInScope(user: AuthenticatedPrincipal, take = 20_000): Promise<string[]> {
    const rows = await this.prisma.lead.findMany({
      where: this.scoped(user),
      select: { id: true },
      take,
    });
    return rows.map((r) => r.id);
  }

  private async activityCountsByOwner(
    user: AuthenticatedPrincipal,
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const leadIds = await this.leadIdsInScope(user);
    const rows = await this.prisma.activity.groupBy({
      by: ['actorId'],
      where: {
        entityType: 'LEAD',
        entityId: { in: leadIds },
        createdAt: { gte: from, lte: to },
        isSystemGenerated: false,
      },
      _count: true,
    });
    return new Map(rows.filter((r) => r.actorId).map((r) => [r.actorId as string, r._count]));
  }

  private async visitCountsByOwner(
    user: AuthenticatedPrincipal,
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const leadIds = await this.leadIdsInScope(user);
    const rows = await this.prisma.visit.groupBy({
      by: ['userId'],
      where: {
        entityType: 'LEAD',
        entityId: { in: leadIds },
        checkInAt: { gte: from, lte: to },
      },
      _count: true,
    });
    return new Map(rows.map((r) => [r.userId, r._count]));
  }

  private async peopleInScope(user: AuthenticatedPrincipal): Promise<number> {
    if (user.dataScope === 'SELF') return 1;
    if (user.dataScope === 'TEAM') return user.teamUserIds.length + 1;
    if (user.dataScope === 'ALL') {
      return this.prisma.user.count({ where: { status: 'ACTIVE', userType: 'INTERNAL' } });
    }
    // ZONE / REGION / BRANCH all resolve to a subtree of the org hierarchy.
    return this.prisma.user.count({
      where: {
        status: 'ACTIVE',
        userType: 'INTERNAL',
        orgUnit: user.orgUnitPath ? { path: { startsWith: user.orgUnitPath } } : undefined,
      },
    });
  }
}
