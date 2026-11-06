import { Injectable } from '@nestjs/common';
import {
  IDLE_AFTER_DAYS,
  MIS_GROUP_STATUSES,
  normaliseStaffCode,
  NON_VERTICAL_NATIONAL_HEAD_CODE,
  MIS_TEAM_CSV_COLUMNS,
  OVERVIEW_MONTHS,
  OVERVIEW_WEEKS,
  type MisCounts,
  type MisHeadline,
  type MisOverview,
  type MisTrendPoint,
  type MisTeamQuery,
  type MisTeamReport,
  type MisTeamRow,
} from '@sihl-one/contracts';

import { toCsv } from '../../common/csv';
import { istDayKey } from '../../common/ist-day';
import { PrismaService } from '../../prisma/prisma.service';

/** An empty set of counts. Written once so a row can never be partly built. */
function noCounts(): MisCounts {
  return { untouched: 0, inProgress: 0, converted: 0, lost: 0, total: 0 };
}

function addCounts(into: MisCounts, from: MisCounts): void {
  into.untouched += from.untouched;
  into.inProgress += from.inProgress;
  into.converted += from.converted;
  into.lost += from.lost;
  into.total += from.total;
}

function isEmpty(counts: MisCounts): boolean {
  return counts.total === 0;
}

/** Which group a lead status belongs to, resolved once into a lookup. */
const GROUP_OF = new Map<string, keyof Omit<MisCounts, 'total'>>();
for (const [group, statuses] of Object.entries(MIS_GROUP_STATUSES)) {
  for (const status of statuses) {
    GROUP_OF.set(status, group as keyof Omit<MisCounts, 'total'>);
  }
}

/**
 * The CEO's view of the firm, down the reporting line.
 *
 * Built from four bulk reads and assembled in memory rather than walked per
 * person. A tree of a few hundred people walked with a query per hop is a few
 * hundred queries for a page somebody opens every morning; the whole
 * directory and the whole lead book, grouped, is four.
 */
@Injectable()
export class MisService {
  constructor(private readonly prisma: PrismaService) {}

  async teamReport(query: MisTeamQuery): Promise<MisTeamReport> {
    const now = new Date();

    const [people, leadRows, activity, visits, createdLeads] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          managerId: true,
          designation: { select: { name: true } },
        },
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId', 'status'],
        where: { deletedAt: null, mergedIntoId: null },
        _count: { _all: true },
      }),
      // The three things a person does that count as having worked.
      this.prisma.activity.groupBy({
        by: ['actorId'],
        _max: { occurredAt: true },
      }),
      this.prisma.visit.groupBy({
        by: ['userId'],
        where: { checkInAt: { not: null } },
        _max: { checkInAt: true },
      }),
      this.prisma.lead.groupBy({
        by: ['createdById'],
        where: { deletedAt: null },
        _max: { createdAt: true },
      }),
    ]);

    // --- the directory -----------------------------------------------------

    const names = new Map<string, string>();
    const codes = new Map<string, string | null>();
    const designations = new Map<string, string | null>();
    const managerOf = new Map<string, string | null>();
    const reportsOf = new Map<string, string[]>();

    for (const person of people) {
      names.set(person.id, `${person.firstName} ${person.lastName}`.trim());
      codes.set(person.id, person.employeeCode);
      designations.set(person.id, person.designation?.name ?? null);
      managerOf.set(person.id, person.managerId);
      if (person.managerId) {
        const siblings = reportsOf.get(person.managerId) ?? [];
        siblings.push(person.id);
        reportsOf.set(person.managerId, siblings);
      }
    }

    const chief =
      people.find(
        (person) =>
          normaliseStaffCode(person.employeeCode ?? '') === NON_VERTICAL_NATIONAL_HEAD_CODE,
      ) ?? null;

    // --- each person's own book -------------------------------------------

    const ownBooks = new Map<string, MisCounts>();
    const unassigned = noCounts();

    for (const row of leadRows) {
      const group = GROUP_OF.get(row.status);
      if (!group) continue;
      const count = row._count._all;

      if (!row.ownerId) {
        unassigned[group] += count;
        unassigned.total += count;
        continue;
      }
      const book = ownBooks.get(row.ownerId) ?? noCounts();
      book[group] += count;
      book.total += count;
      ownBooks.set(row.ownerId, book);
    }

    // --- each person's last day of work ------------------------------------

    const lastActive = new Map<string, Date>();
    const remember = (id: string | null, when: Date | null | undefined): void => {
      if (!id || !when) return;
      const held = lastActive.get(id);
      if (!held || when > held) lastActive.set(id, when);
    };
    for (const row of activity) remember(row.actorId, row._max.occurredAt);
    for (const row of visits) remember(row.userId, row._max.checkInAt);
    for (const row of createdLeads) remember(row.createdById, row._max.createdAt);

    /*
      Idle days are counted in IST days, not in elapsed hours.

      Somebody who worked at eleven last night and is read at nine this
      morning has been idle for ten hours and nought days, which is the
      answer a manager means. Subtracting instants would call that one day on
      some mornings and nought on others, depending on the hour the report
      was opened.
    */
    const today = istDayKey(now);
    const daysIdle = (when: Date): number => {
      const from = Date.parse(`${istDayKey(when)}T00:00:00.000+05:30`);
      const to = Date.parse(`${today}T00:00:00.000+05:30`);
      return Math.max(0, Math.round((to - from) / 86_400_000));
    };

    // --- the tree ----------------------------------------------------------

    const placed = new Set<string>();

    const build = (userId: string, level: number): MisTeamRow => {
      placed.add(userId);
      const managerId = managerOf.get(userId) ?? null;
      const own = ownBooks.get(userId) ?? noCounts();
      const children = (reportsOf.get(userId) ?? [])
        .map((childId) => build(childId, level + 1))
        .sort((a, b) => b.counts.total - a.counts.total || a.name.localeCompare(b.name));

      const counts = noCounts();
      addCounts(counts, own);
      for (const child of children) addCounts(counts, child.counts);

      const when = lastActive.get(userId);
      let newest: Date | null = when ?? null;
      let teamSize = 1;
      let idleCount = when === undefined || daysIdle(when) >= IDLE_AFTER_DAYS ? 1 : 0;

      for (const child of children) {
        teamSize += child.teamSize;
        idleCount += child.idleCount;
        if (child.lastActivityOn) {
          const childWhen = new Date(`${child.lastActivityOn}T00:00:00.000+05:30`);
          if (!newest || childWhen > newest) newest = childWhen;
        }
      }

      return {
        userId,
        name: names.get(userId) ?? 'Unknown',
        employeeCode: codes.get(userId) ?? null,
        designation: designations.get(userId) ?? null,
        level,
        reportsTo: managerId ? (names.get(managerId) ?? null) : null,
        teamSize,
        idleCount,
        counts,
        lastActivityOn: newest ? istDayKey(newest) : null,
        idleDays: newest ? daysIdle(newest) : null,
        // Only when there is something to show. A row of zeros under every
        // manager is noise that hides the ones that matter.
        ownBook: isEmpty(own) ? null : own,
        children,
      };
    };

    const heads = chief ? (reportsOf.get(chief.id) ?? []) : [];
    const wanted = query.verticalHeadId ? heads.filter((id) => id === query.verticalHeadId) : heads;
    const rows = wanted
      .map((id) => build(id, 0))
      .sort((a, b) => b.counts.total - a.counts.total || a.name.localeCompare(b.name));

    // --- what the tree could not hold --------------------------------------

    const chiefOwnBook = chief ? (ownBooks.get(chief.id) ?? noCounts()) : noCounts();

    const outsideStructure = noCounts();
    for (const [ownerId, book] of ownBooks) {
      if (placed.has(ownerId)) continue;
      if (chief && ownerId === chief.id) continue;
      addCounts(outsideStructure, book);
    }

    const totals = noCounts();
    for (const row of rows) addCounts(totals, row.counts);
    addCounts(totals, chiefOwnBook);
    addCounts(totals, unassigned);
    addCounts(totals, outsideStructure);

    /*
      Counted from the book rather than summed from the rows.

      The two should agree, and saying so is the point: a difference means a
      lead is owned by somebody the hierarchy does not reach, and the report
      would otherwise simply be short without anybody noticing.
    */
    const uniqueLeads = await this.prisma.lead.count({
      where: { deletedAt: null, mergedIntoId: null },
    });

    let totalPeople = 0;
    let totalIdle = 0;
    for (const row of rows) {
      totalPeople += row.teamSize;
      totalIdle += row.idleCount;
    }

    return {
      asOn: today,
      chief: chief
        ? {
            userId: chief.id,
            name: `${chief.firstName} ${chief.lastName}`.trim(),
            employeeCode: chief.employeeCode,
          }
        : null,
      rows,
      exceptions: {
        chiefOwnBook: isEmpty(chiefOwnBook) ? null : chiefOwnBook,
        unassigned,
        outsideStructure,
      },
      totals,
      uniqueLeads,
      totalPeople,
      totalIdle,
      idleAfterDays: IDLE_AFTER_DAYS,
    };
  }

  /**
   * The same report as a file, flattened.
   *
   * Every level, not the expanded ones: a spreadsheet is opened to be pivoted
   * and filtered, and a file that mirrored whatever happened to be open on
   * screen would be a different report each time it was downloaded.
   *
   * `Level` and `Reports to` carry the shape the indentation carries on
   * screen, so the nesting survives a tool that knows nothing about it.
   */
  async teamCsv(query: MisTeamQuery): Promise<{ csv: string; asOn: string }> {
    const report = await this.teamReport(query);
    const rows: string[][] = [];

    const line = (row: MisTeamRow): void => {
      rows.push([
        String(row.level),
        row.name,
        row.employeeCode ?? '',
        row.designation ?? '',
        row.reportsTo ?? '',
        String(row.teamSize),
        String(row.idleCount),
        String(row.counts.untouched),
        String(row.counts.inProgress),
        String(row.counts.converted),
        String(row.counts.lost),
        String(row.counts.total),
        row.lastActivityOn ?? 'Never',
        row.idleDays === null ? '' : String(row.idleDays),
      ]);
      // The manager's own book, on the same terms as the screen: only where
      // there are reports for it to be distinguished from.
      if (row.ownBook && row.children.length > 0) {
        rows.push([
          String(row.level + 1),
          `${row.name} — own book`,
          row.employeeCode ?? '',
          row.designation ?? '',
          row.name,
          '',
          '',
          String(row.ownBook.untouched),
          String(row.ownBook.inProgress),
          String(row.ownBook.converted),
          String(row.ownBook.lost),
          String(row.ownBook.total),
          '',
          '',
        ]);
      }
      for (const child of row.children) line(child);
    };

    for (const row of report.rows) line(row);

    const exception = (label: string, counts: MisCounts): void => {
      if (counts.total === 0) return;
      rows.push([
        '0',
        label,
        '',
        '',
        '',
        '',
        '',
        String(counts.untouched),
        String(counts.inProgress),
        String(counts.converted),
        String(counts.lost),
        String(counts.total),
        '',
        '',
      ]);
    };
    if (report.exceptions.chiefOwnBook) {
      exception(
        `${report.chief?.name ?? 'Chief executive'} — own book`,
        report.exceptions.chiefOwnBook,
      );
    }
    exception('Unassigned', report.exceptions.unassigned);
    exception('Owned outside the structure', report.exceptions.outsideStructure);

    return { csv: toCsv(MIS_TEAM_CSV_COLUMNS, rows), asOn: report.asOn };
  }

  // -------------------------------------------------------------------------
  // CEO overview
  // -------------------------------------------------------------------------

  /**
   * The same firm as charts.
   *
   * The vertical comparison is taken from `teamReport` rather than queried
   * again, so the bars and the table cannot disagree about what a vertical is
   * carrying — which they would, eventually, if each counted for itself.
   */
  async overview(): Promise<MisOverview> {
    const now = new Date();
    const team = await this.teamReport({});

    /*
      Buckets built from IST days, not from UTC instants.

      A lead created at eleven at night in Mumbai is `createdAt` the next day
      in UTC. Bucketing on the stored instant would push a slice of every
      evening into the following week, and the last week of a month into the
      next month — precisely the error CR-13 found in the reports.
    */
    const weekKeys = lastWeeks(now, OVERVIEW_WEEKS);
    const monthKeys = lastMonths(now, OVERVIEW_MONTHS);
    const earliestWeek = new Date(`${weekKeys[0].start}T00:00:00.000+05:30`);
    const earliestMonth = new Date(`${monthKeys[0].key}-01T00:00:00.000+05:30`);
    const from = earliestWeek < earliestMonth ? earliestWeek : earliestMonth;

    const [created, converted] = await Promise.all([
      this.prisma.lead.findMany({
        where: { deletedAt: null, mergedIntoId: null, createdAt: { gte: from } },
        select: { createdAt: true },
      }),
      this.prisma.lead.findMany({
        where: { deletedAt: null, mergedIntoId: null, convertedAt: { gte: from } },
        select: { convertedAt: true },
      }),
    ]);

    const weekly = bucket(weekKeys, weekKeyOf);
    const monthly = bucket(monthKeys, (day) => day.slice(0, 7));

    for (const row of created) {
      const day = istDayKey(row.createdAt);
      weekly.add(day, 'created');
      monthly.add(day, 'created');
    }
    for (const row of converted) {
      if (!row.convertedAt) continue;
      const day = istDayKey(row.convertedAt);
      weekly.add(day, 'converted');
      monthly.add(day, 'converted');
    }

    const months = monthly.points();
    const thisMonth = months[months.length - 1];
    const lastMonth = months[months.length - 2];

    const rate = (point: MisTrendPoint | undefined): number | null =>
      point && point.created > 0 ? Math.round((point.converted / point.created) * 1000) / 10 : null;

    const thisRate = rate(thisMonth);
    const lastRate = rate(lastMonth);

    return {
      asOn: team.asOn,
      periodLabel: monthLabel(istDayKey(now).slice(0, 7), true),
      leadsCreated: headline(thisMonth?.created ?? 0, lastMonth?.created ?? 0, true),
      converted: headline(thisMonth?.converted ?? 0, lastMonth?.converted ?? 0, true),
      conversionRate: {
        value: thisRate,
        previous: lastRate,
        better: thisRate === null || lastRate === null ? null : thisRate >= lastRate,
      },
      /*
        Idle has no previous period to compare against.

        It is a state of the firm right now, not a count of something that
        happened during November, so there is no October figure that would
        mean the same thing. Carried as a plain number with no movement
        rather than invented.
      */
      idlePeople: {
        value: team.totalIdle,
        previous: team.totalIdle,
        changePercent: null,
        better: null,
      },
      weekly: weekly.points(),
      monthly: months,
      verticals: team.rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        counts: row.counts,
        conversionRate:
          row.counts.total > 0
            ? Math.round((row.counts.converted / row.counts.total) * 1000) / 10
            : null,
        teamSize: row.teamSize,
        idleCount: row.idleCount,
      })),
      idleAfterDays: IDLE_AFTER_DAYS,
    };
  }
}

// ---------------------------------------------------------------------------
// Bucketing, all of it in IST days
// ---------------------------------------------------------------------------

/** A headline and its movement. `risingIsGood` decides wording and colour. */
function headline(value: number, previous: number, risingIsGood: boolean): MisHeadline {
  const changePercent =
    previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : null;
  const better = value === previous ? null : risingIsGood ? value > previous : value < previous;
  return { value, previous, changePercent, better };
}

/** Monday of the week a day falls in, as `YYYY-MM-DD`. */
function mondayOf(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  // getUTCDay puts Sunday at 0, which is the end of the week here, not its
  // start — so shift by six before taking the remainder.
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

/** Keyed on the Monday, so two spellings of "week 45" cannot disagree. */
function weekKeyOf(dayKey: string): string {
  return `W${mondayOf(dayKey)}`;
}

function dayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

function monthLabel(monthKey: string, long = false): string {
  const date = new Date(`${monthKey}-01T00:00:00.000Z`);
  return date.toLocaleDateString('en-IN', {
    month: long ? 'long' : 'short',
    year: long ? 'numeric' : '2-digit',
    timeZone: 'UTC',
  });
}

function lastWeeks(
  now: Date,
  count: number,
): Array<{ period: string; label: string; start: string }> {
  const thisMonday = mondayOf(istDayKey(now));
  const weeks: Array<{ period: string; label: string; start: string }> = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(`${thisMonday}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - back * 7);
    const start = date.toISOString().slice(0, 10);
    weeks.push({ period: `W${start}`, label: dayLabel(start), start });
  }
  return weeks;
}

function lastMonths(
  now: Date,
  count: number,
): Array<{ period: string; label: string; key: string }> {
  const parts = istDayKey(now).split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const months: Array<{ period: string; label: string; key: string }> = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    const key = date.toISOString().slice(0, 7);
    months.push({ period: key, label: monthLabel(key), key });
  }
  return months;
}

/**
 * Fixed buckets that ignore anything falling outside them.
 *
 * Seeded from the key list rather than grown from the data, so a week nobody
 * worked still appears as a zero. A trend with missing weeks reads as a
 * shorter period rather than a quiet one.
 */
function bucket(
  keys: ReadonlyArray<{ period: string; label: string }>,
  keyOf: (dayKey: string) => string,
) {
  const index = new Map<string, MisTrendPoint>();
  const ordered: MisTrendPoint[] = keys.map((k) => {
    const point: MisTrendPoint = { period: k.period, label: k.label, created: 0, converted: 0 };
    index.set(k.period, point);
    return point;
  });

  return {
    add(dayKey: string, field: 'created' | 'converted') {
      const point = index.get(keyOf(dayKey));
      if (point) point[field] += 1;
    },
    points: () => ordered,
  };
}
