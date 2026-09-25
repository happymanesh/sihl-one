import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ACTIVITY_METRIC_LABELS,
  defaultActivityDate,
  istDayWindow,
  type ActivityDetail,
  type ActivityTotals,
  type ActivityDetailQuery,
  type ActivityDetailRow,
  type LeadListItem,
  type DailyActivityGroup,
  type DailyActivityQuery,
  type DailyActivityReport,
  type DailyActivityRow,
} from '@sihl-one/contracts';

import { LEAD_LIST_SELECT, toLeadListItem, type LeadRow } from '../leads/lead.mapper';

import { PrismaService } from '../../prisma/prisma.service';
import { istDayKey } from '../../common/ist-day';
import type { AuthenticatedPrincipal } from '../../common/types';

/** A row with every count at zero, which is the row that matters most here. */
const EMPTY = {
  openLeads: 0,
  leadsAssigned: 0,
  leadsCreated: 0,
  mobilesVerified: 0,
  leadsUpdated: 0,
  visitsDone: 0,
  joinedVisits: 0,
  converted: 0,
  lost: 0,
  total: 0,
};

/** Adds a set of rows column by column. Used for both subtotals and the whole. */
function sumRows(rows: readonly DailyActivityRow[]): ActivityTotals {
  return rows.reduce<ActivityTotals>(
    (sum, row) => ({
      openLeads: sum.openLeads + row.openLeads,
      leadsAssigned: sum.leadsAssigned + row.leadsAssigned,
      leadsCreated: sum.leadsCreated + row.leadsCreated,
      mobilesVerified: sum.mobilesVerified + row.mobilesVerified,
      leadsUpdated: sum.leadsUpdated + row.leadsUpdated,
      visitsDone: sum.visitsDone + row.visitsDone,
      joinedVisits: sum.joinedVisits + row.joinedVisits,
      converted: sum.converted + row.converted,
      lost: sum.lost + row.lost,
      total: sum.total + row.total,
    }),
    { ...EMPTY },
  );
}

/**
 * The daily activity report.
 *
 * Scoped by **people**, not by leads — which is the difference between this and
 * every other report in the module. The others ask "what happened to the leads
 * I can see"; this asks "what did the people under me do", and a rep who did
 * nothing owns no leads to find them by. Scoping the usual way would drop
 * exactly the person the report exists to surface.
 */
@Injectable()
export class DailyActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    user: AuthenticatedPrincipal,
    query: DailyActivityQuery,
  ): Promise<DailyActivityReport> {
    const date = query.date ?? defaultActivityDate();
    const { from, to } = istDayWindow(date);

    const people = await this.peopleInScope(user);
    if (people.length === 0) {
      return {
        date,
        partial: this.isToday(date),
        groups: [],
        overall: { ...EMPTY },
        idleCount: 0,
        peopleCount: 0,
      };
    }

    const ids = people.map((person) => person.id);
    const window = { gte: from, lte: to };

    const [assigned, created, verified, updated, visits, joined, statuses, open] =
      await Promise.all([
        // Who a lead was given to, from the audit payload rather than the lead's
        // current owner — the point is what changed hands that day.
        this.prisma.auditLog.findMany({
          where: { action: 'ASSIGN', resource: 'lead', createdAt: window },
          select: { changes: true },
        }),
        this.prisma.lead.groupBy({
          by: ['createdById'],
          where: { createdById: { in: ids }, createdAt: window },
          _count: true,
        }),
        this.prisma.lead.groupBy({
          by: ['mobileVerifiedById'],
          where: { mobileVerifiedById: { in: ids }, mobileVerifiedAt: window },
          _count: true,
        }),
        // Edits, from the audit trail. `lead.updatedById` holds only the last
        // writer, so it cannot answer "which leads did this person touch on
        // Tuesday" — the row has been overwritten since.
        this.prisma.auditLog.groupBy({
          by: ['actorId'],
          where: {
            actorId: { in: ids },
            action: { in: ['UPDATE', 'STATUS_CHANGE'] },
            resource: 'lead',
            createdAt: window,
          },
          _count: true,
        }),
        this.prisma.visit.groupBy({
          by: ['userId'],
          where: { userId: { in: ids }, checkInAt: window },
          _count: true,
        }),
        // Support on somebody else's visit, counted only when confirmed present.
        this.prisma.attendee.groupBy({
          by: ['userId'],
          where: {
            userId: { in: ids },
            confirmedAt: { not: null },
            visit: { checkInAt: window },
          },
          _count: true,
        }),
        // Outcomes come from the status history, which names who changed it and
        // when — the lead's own convertedAt has no actor.
        this.prisma.leadStatusHistory.groupBy({
          by: ['changedById', 'toStatus'],
          where: {
            changedById: { in: ids },
            changedAt: window,
            toStatus: { in: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
          },
          _count: true,
        }),
        // The backlog each person was carrying at the end of that day.
        //
        // Reconstructed from the status history rather than read from
        // `lead.closedAt`, which is populated on almost nothing — two rows out of
        // a hundred and seventy in production. A lead counts as open if it
        // existed by the end of the day and had not yet reached a closed status
        // by then.
        //
        // Ownership is the *current* owner. Reconstructing who held a lead on a
        // past date is possible from the assignment audit but expensive, and for
        // a report that defaults to yesterday it would change almost nothing.
        // Worth knowing before anyone reads a three-month-old day.
        this.prisma.lead.groupBy({
          by: ['ownerId'],
          where: {
            ownerId: { in: ids },
            deletedAt: null,
            createdAt: { lte: to },
            statusHistory: {
              none: {
                toStatus: { in: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
                changedAt: { lte: to },
              },
            },
          },
          _count: true,
        }),
      ]);

    const assignedTo = new Map<string, number>();
    for (const row of assigned) {
      const to = (row.changes as { to?: unknown } | null)?.to;
      if (typeof to === 'string' && ids.includes(to)) {
        assignedTo.set(to, (assignedTo.get(to) ?? 0) + 1);
      }
    }

    const tally = (
      rows: Array<{ _count: number } & Record<string, unknown>>,
      key: string,
    ): Map<string, number> =>
      new Map(
        rows
          .filter((row) => typeof row[key] === 'string')
          .map((row) => [row[key] as string, row._count]),
      );

    const createdBy = tally(created, 'createdById');
    const verifiedBy = tally(verified, 'mobileVerifiedById');
    const updatedBy = tally(updated, 'actorId');
    const visitedBy = tally(visits, 'userId');
    const joinedBy = tally(joined, 'userId');
    const openBy = tally(open, 'ownerId');

    const convertedBy = new Map<string, number>();
    const lostBy = new Map<string, number>();
    for (const row of statuses) {
      if (!row.changedById) continue;
      const bucket = row.toStatus === 'CONVERTED' ? convertedBy : lostBy;
      bucket.set(row.changedById, (bucket.get(row.changedById) ?? 0) + row._count);
    }

    const rows: DailyActivityRow[] = people.map((person) => {
      const counts = {
        leadsAssigned: assignedTo.get(person.id) ?? 0,
        leadsCreated: createdBy.get(person.id) ?? 0,
        mobilesVerified: verifiedBy.get(person.id) ?? 0,
        leadsUpdated: updatedBy.get(person.id) ?? 0,
        visitsDone: visitedBy.get(person.id) ?? 0,
        joinedVisits: joinedBy.get(person.id) ?? 0,
        converted: convertedBy.get(person.id) ?? 0,
        lost: lostBy.get(person.id) ?? 0,
      };
      const openLeads = openBy.get(person.id) ?? 0;
      return {
        userId: person.id,
        fullName: `${person.firstName} ${person.lastName}`.trim(),
        employeeCode: person.employeeCode,
        branch: person.orgUnit?.name ?? null,
        branchCode: person.orgUnit?.code ?? null,
        manager: person.manager
          ? `${person.manager.firstName} ${person.manager.lastName}`.trim()
          : null,
        openLeads,
        ...counts,
        // Deliberately excludes openLeads. The total answers "did they do
        // anything today"; a standing backlog is not something they did, and
        // folding it in would make the idle row with ninety untouched leads
        // look like the busiest person on the page.
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      };
    });

    return {
      date,
      partial: this.isToday(date),
      groups: await this.group(user, people, rows),
      // Summed from the people, not from the groups: a person belongs to exactly
      // one group today, but that is a property of how grouping happens to work
      // rather than something the total should depend on.
      overall: sumRows(rows),
      idleCount: rows.filter((row) => row.total === 0).length,
      peopleCount: rows.length,
    };
  }

  /**
   * The records behind one number.
   *
   * Re-checks scope from scratch rather than trusting the id in the URL: a
   * drill-down is a separate request, and "this person appeared on a report I
   * could see" is not a reason to hand over their leads afterwards.
   *
   * Lead metrics come back in the leads-list shape, through the same mapper the
   * Leads screen uses. A second rendering of a lead would drift from the first
   * one within a release or two, and a manager who drills into a figure and
   * meets an unfamiliar table has to learn the screen twice.
   *
   * Capped at 200 records. A cell showing four hundred is a backlog to work
   * through on the Leads screen, not a list to read on a report.
   */
  async detail(user: AuthenticatedPrincipal, query: ActivityDetailQuery): Promise<ActivityDetail> {
    const people = await this.peopleInScope(user);
    const person = people.find((candidate) => candidate.id === query.userId);
    if (!person) {
      throw new NotFoundException({
        title: 'Not in your view',
        detail: 'That person is not somebody you can report on.',
      });
    }

    const { from, to } = istDayWindow(query.date);
    const window = { gte: from, lte: to };
    const take = 201;

    /** Leads by id, in the order the ids were given. */
    const leadsByIds = async (ids: string[]): Promise<LeadListItem[]> => {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];
      const found = await this.prisma.lead.findMany({
        where: { id: { in: unique }, deletedAt: null },
        select: LEAD_LIST_SELECT,
      });
      const byId = new Map(found.map((row) => [row.id, toLeadListItem(row as unknown as LeadRow)]));
      return unique
        .map((id) => byId.get(id))
        .filter((lead): lead is LeadListItem => lead !== undefined);
    };

    let leads: LeadListItem[] = [];
    let visits: ActivityDetailRow[] = [];
    // Defaults to the number of records found; only the metrics that count
    // events rather than leads override it.
    let count: number | null = null;

    switch (query.metric) {
      case 'openLeads': {
        const found = await this.prisma.lead.findMany({
          where: {
            ownerId: person.id,
            deletedAt: null,
            createdAt: { lte: to },
            statusHistory: {
              none: {
                toStatus: { in: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
                changedAt: { lte: to },
              },
            },
          },
          select: LEAD_LIST_SELECT,
          // Follow-up date first, so the overdue end of the backlog is what a
          // manager meets rather than the newest lead.
          orderBy: [{ nextFollowUpAt: 'asc' }, { createdAt: 'desc' }],
          take,
        });
        leads = found.map((row) => toLeadListItem(row as unknown as LeadRow));
        break;
      }

      case 'leadsCreated': {
        const found = await this.prisma.lead.findMany({
          where: { createdById: person.id, createdAt: window },
          select: LEAD_LIST_SELECT,
          orderBy: { createdAt: 'desc' },
          take,
        });
        leads = found.map((row) => toLeadListItem(row as unknown as LeadRow));
        break;
      }

      case 'mobilesVerified': {
        const found = await this.prisma.lead.findMany({
          where: { mobileVerifiedById: person.id, mobileVerifiedAt: window },
          select: LEAD_LIST_SELECT,
          orderBy: { mobileVerifiedAt: 'desc' },
          take,
        });
        leads = found.map((row) => toLeadListItem(row as unknown as LeadRow));
        break;
      }

      case 'leadsAssigned': {
        const audit = await this.prisma.auditLog.findMany({
          where: { action: 'ASSIGN', resource: 'lead', createdAt: window },
          select: { resourceId: true, changes: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        });
        const mine = audit.filter(
          (row) => (row.changes as { to?: unknown } | null)?.to === person.id,
        );
        count = mine.length;
        leads = await leadsByIds(
          mine.map((row) => row.resourceId).filter((id): id is string => Boolean(id)),
        );
        break;
      }

      case 'leadsUpdated': {
        const audit = await this.prisma.auditLog.findMany({
          where: {
            actorId: person.id,
            action: { in: ['UPDATE', 'STATUS_CHANGE'] },
            resource: 'lead',
            createdAt: window,
          },
          select: { resourceId: true },
          orderBy: { createdAt: 'desc' },
        });
        // The report counts edits; this lists leads. Ten edits to four leads is
        // ten there and four rows here, so the real figure travels separately
        // rather than the two quietly disagreeing.
        count = audit.length;
        leads = await leadsByIds(
          audit.map((row) => row.resourceId).filter((id): id is string => Boolean(id)),
        );
        break;
      }

      case 'converted':
      case 'lost': {
        const reached = query.metric === 'converted' ? ['CONVERTED'] : ['LOST', 'DISQUALIFIED'];
        const history = await this.prisma.leadStatusHistory.findMany({
          where: {
            changedById: person.id,
            changedAt: window,
            toStatus: { in: reached as never },
          },
          select: { leadId: true },
          orderBy: { changedAt: 'desc' },
        });
        count = history.length;
        leads = await leadsByIds(history.map((entry) => entry.leadId));
        break;
      }

      case 'visitsDone': {
        const found = await this.prisma.visit.findMany({
          where: { userId: person.id, checkInAt: window },
          select: { id: true, reference: true, purpose: true, status: true, checkInAt: true },
          orderBy: { checkInAt: 'desc' },
          take,
        });
        visits = found.map((visit) => ({
          id: visit.id,
          reference: visit.reference,
          title: visit.purpose,
          subtitle: visit.status,
          at: visit.checkInAt ? visit.checkInAt.toISOString() : null,
          href: `/visits/${visit.id}`,
        }));
        break;
      }

      case 'joinedVisits': {
        const joined = await this.prisma.attendee.findMany({
          where: {
            userId: person.id,
            confirmedAt: { not: null },
            visit: { checkInAt: window },
          },
          select: {
            visit: {
              select: { id: true, reference: true, purpose: true, status: true, checkInAt: true },
            },
          },
          take,
        });
        visits = joined
          .map((row) => row.visit)
          .filter((visit): visit is NonNullable<typeof visit> => visit !== null)
          .map((visit) => ({
            id: visit.id,
            reference: visit.reference,
            title: visit.purpose,
            subtitle: visit.status,
            at: visit.checkInAt ? visit.checkInAt.toISOString() : null,
            href: `/visits/${visit.id}`,
          }));
        break;
      }
    }

    const found = leads.length + visits.length;
    return {
      metric: query.metric,
      label: ACTIVITY_METRIC_LABELS[query.metric],
      date: query.date,
      person: {
        userId: person.id,
        fullName: [person.firstName, person.lastName].filter(Boolean).join(' '),
        employeeCode: person.employeeCode,
      },
      count: count ?? Math.min(found, 200),
      leads: leads.slice(0, 200),
      visits: visits.slice(0, 200),
      truncated: found > 200,
    };
  }

  /**
   * The staff this person may see, by org subtree.
   *
   * SELF is one row — their own. Everyone else is resolved from the org unit's
   * materialised path, so a national head gets the company and a branch manager
   * gets their branch, without either asking for it.
   */
  private async peopleInScope(user: AuthenticatedPrincipal) {
    const select = {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      orgUnit: { select: { id: true, code: true, name: true, type: true, path: true } },
      manager: { select: { firstName: true, lastName: true } },
    } as const;

    const base = { deletedAt: null, userType: 'INTERNAL' as const, status: 'ACTIVE' as const };

    if (user.dataScope === 'SELF') {
      return this.prisma.user.findMany({ where: { ...base, id: user.id }, select });
    }
    if (user.dataScope === 'TEAM') {
      return this.prisma.user.findMany({
        where: { ...base, id: { in: [user.id, ...user.teamUserIds] } },
        select,
      });
    }
    if (user.dataScope === 'ALL' || !user.orgUnitPath) {
      return this.prisma.user.findMany({ where: base, select, orderBy: { firstName: 'asc' } });
    }
    return this.prisma.user.findMany({
      where: { ...base, orgUnit: { path: { startsWith: user.orgUnitPath } } },
      select,
      orderBy: { firstName: 'asc' },
    });
  }

  /**
   * Group the rows under the org units they belong to.
   *
   * Grouping is by the unit each person actually sits in. Regions and zones
   * hold no staff of their own, so they appear only as a heading when they have
   * branches underneath — reporting "Gujarat Region: 0" while sixteen people
   * below it worked all day would be worse than not showing the region at all.
   */
  private async group(
    user: AuthenticatedPrincipal,
    people: Array<{
      id: string;
      orgUnit: { id: string; code: string; name: string; type: string; path: string } | null;
    }>,
    rows: DailyActivityRow[],
  ): Promise<DailyActivityGroup[]> {
    const byId = new Map(rows.map((row) => [row.userId, row]));
    const units = new Map<
      string,
      { code: string; name: string; type: string; path: string; rows: DailyActivityRow[] }
    >();

    for (const person of people) {
      const row = byId.get(person.id);
      if (!row) continue;
      const unit = person.orgUnit;
      const key = unit?.id ?? 'none';
      const existing = units.get(key) ?? {
        code: unit?.code ?? '—',
        name: unit?.name ?? 'No branch',
        type: unit?.type ?? 'NONE',
        path: unit?.path ?? '',
        rows: [],
      };
      existing.rows.push(row);
      units.set(key, existing);
    }

    return [...units.entries()]
      .map(([orgUnitId, unit]): DailyActivityGroup => {
        const subtotal = sumRows(unit.rows);
        return {
          orgUnitId,
          code: unit.code,
          name: unit.name,
          type: unit.type,
          // Segments in the materialised path, so the page can indent a branch
          // under its region without walking the tree itself.
          depth: unit.path ? unit.path.split('/').filter(Boolean).length : 0,
          rows: unit.rows.sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName)),
          subtotal,
        };
      })
      .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  }

  /** A day still in progress is reported as partial, never as a final figure. */
  private isToday(date: string): boolean {
    return date === istDayKey(new Date());
  }
}
