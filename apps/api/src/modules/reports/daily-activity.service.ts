import { Injectable } from '@nestjs/common';
import {
  defaultActivityDate,
  istDayWindow,
  type DailyActivityGroup,
  type DailyActivityQuery,
  type DailyActivityReport,
  type DailyActivityRow,
} from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/types';

/** A row with every count at zero, which is the row that matters most here. */
const EMPTY = {
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
      return { date, partial: this.isToday(date), groups: [], idleCount: 0, peopleCount: 0 };
    }

    const ids = people.map((person) => person.id);
    const window = { gte: from, lte: to };

    const [assigned, created, verified, updated, visits, joined, statuses] = await Promise.all([
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
      return {
        userId: person.id,
        fullName: `${person.firstName} ${person.lastName}`.trim(),
        employeeCode: person.employeeCode,
        branch: person.orgUnit?.name ?? null,
        branchCode: person.orgUnit?.code ?? null,
        manager: person.manager
          ? `${person.manager.firstName} ${person.manager.lastName}`.trim()
          : null,
        ...counts,
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      };
    });

    return {
      date,
      partial: this.isToday(date),
      groups: await this.group(user, people, rows),
      idleCount: rows.filter((row) => row.total === 0).length,
      peopleCount: rows.length,
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
    people: Array<{ id: string; orgUnit: { id: string; code: string; name: string; type: string; path: string } | null }>,
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
        const subtotal = unit.rows.reduce(
          (sum, row) => ({
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
    return date === new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  }
}
