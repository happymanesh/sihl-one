import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SLIPPING_DAYS,
  computeRating,
  rate,
  verticalHeadOf,
  type PerformanceProgress,
  type PerformanceReport,
  type PerformanceReportQuery,
  type PerformanceResourceRow,
  type PerformanceTotals,
  type RatedLead,
  type SendPerformanceReportInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { Mailer } from '../mail/mailer';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { istDayKey } from '../../common/ist-day';

/** No interaction in this many days is "slipping". Asked for explicitly. */

/**
 * Below this many leads a rating is noise, so none is published.
 *
 * The same scepticism `computeRating` applies through shrinkage, made visible:
 * a number computed from three leads reads as a verdict on a person, and it is
 * not one.
 */
const MIN_LEADS_TO_RATE = 5;

/**
 * How a team, a region or a branch is doing over a period.
 *
 * Distinct from `PerformanceService`, which answers "how is this one person
 * doing" and is careful never to become a leaderboard. This is the other
 * question — a manager looking at a group they are accountable for — and the
 * two should not be bent into one service because the privacy rules differ.
 *
 * Every count here comes from leads the caller can already see. The scope
 * filter is applied before anything is counted, so the report cannot become a
 * way to read a population somebody has no access to.
 */
@Injectable()
export class PerformanceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
  ) {}

  /**
   * Send a previewed report.
   *
   * One message with everybody on it rather than one each: this is a team
   * report, the recipients are the team, and splitting it would hide from each
   * of them that the others got it too.
   *
   * A failure is returned, not thrown. The sender is standing in front of the
   * preview waiting for an answer, and "it did not go, here is why" is more
   * use to them than a generic error.
   */
  async send(
    user: AuthenticatedPrincipal,
    input: SendPerformanceReportInput,
  ): Promise<{ sent: boolean; recipients: number; failureReason: string | null }> {
    // Before the mailer is touched, and throwing rather than filtering: a
    // sender who typed one address wrong wants to be told, not to have it
    // silently dropped and be left believing that person received the report.
    await this.assertRecipientsAreColleagues(input);

    const result = await this.mailer
      .send({
        to: input.to.join(', '),
        cc: input.cc.length > 0 ? input.cc.join(', ') : undefined,
        subject: input.subject,
        text: input.body,
        html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${input.body
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')}</pre>`,
      })
      .catch((error: unknown) => ({
        accepted: false,
        providerMessageId: null,
        failureReason: error instanceof Error ? error.message.slice(0, 200) : 'Send failed',
      }));

    await this.audit.record({
      action: 'EXPORT',
      resource: 'report.performance',
      reason: `Performance report emailed to ${input.to.length} recipients`,
      changes: {
        // The addresses, not just how many of them there were.
        //
        // This row is the answer to "where did this team's performance go",
        // and a count cannot answer it. Every address here has already been
        // resolved to an active SIHL user, so recording them widens nothing:
        // the staff directory is readable by anybody holding `user:read`.
        recipients: input.to,
        ccRecipients: input.cc,
        to: input.to.length,
        cc: input.cc.length,
        subject: input.subject,
        accepted: result.accepted,
      },
    });

    return {
      sent: result.accepted,
      recipients: input.to.length + input.cc.length,
      failureReason: result.accepted
        ? null
        : (result.failureReason ?? 'The email was not accepted.'),
    };
  }

  /**
   * Every recipient must be a colleague.
   *
   * The design always said so — "this is a team report, the recipients are the
   * team" — but nothing enforced it. The route accepted a hundred `to`
   * addresses, fifty `cc`, and a hundred kilobytes of caller-supplied body,
   * on `analytics:sales:read`. That is not a reporting feature with a loose
   * edge; it is a mail relay that signs as SIHL, and it was reachable by
   * anybody who could open a dashboard.
   *
   * Resolving each address against an active internal user closes it without
   * touching the flow the screens actually use. On the team page the To list
   * is pre-filled from the people in the report; on the verticals page it is
   * the head's own address. Both are SIHL staff by construction, so this
   * refuses nothing the UI legitimately sends.
   *
   * Deliberately *not* narrowed to the caller's data scope. Copying the
   * vertical head above you is the explicit use case on the verticals page,
   * and a scope check would refuse exactly that while buying nothing — the
   * report contains only rows the caller could already see, and the recipient
   * is a colleague either way.
   *
   * It does not police the body. A manager may still send odd prose to their
   * own team, which is a conduct question rather than a platform hole; what
   * has gone is the ability to send it to anybody outside SIHL.
   */
  private async assertRecipientsAreColleagues(input: SendPerformanceReportInput): Promise<void> {
    const wanted = [...new Set([...input.to, ...input.cc])];
    if (wanted.length === 0) return;

    const known = await this.prisma.user.findMany({
      where: {
        email: { in: wanted },
        userType: 'INTERNAL',
        // An address that has been suspended, locked, disabled or never
        // accepted its invitation is not somebody to mail a team's numbers to.
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { email: true },
    });

    const found = new Set(known.map((row) => row.email));
    const strangers = wanted.filter((address) => !found.has(address));
    if (strangers.length === 0) return;

    // Named per field, so the dialog can mark the box the bad address is in
    // rather than reporting "something is wrong" above both of them.
    const errors: Record<string, string[]> = {};
    const blame = (field: 'to' | 'cc', addresses: readonly string[]) => {
      const mine = addresses.filter((address) => strangers.includes(address));
      if (mine.length > 0) {
        errors[field] = mine.map((address) => `${address} is not an active SIHL user.`);
      }
    };
    blame('to', input.to);
    blame('cc', input.cc);

    throw new BadRequestException({
      title: 'Recipients must be SIHL staff',
      detail:
        'A performance report names colleagues and their numbers, so it can only be emailed ' +
        `inside SIHL. Not recognised: ${strangers.join(', ')}.`,
      errors,
    });
  }

  /**
   * The window, and the equal-length window before it.
   *
   * IST throughout: the business day is Indian, and a report generated at
   * 00:30 that silently covered "yesterday UTC" would disagree with the screen
   * it was downloaded from.
   */
  private window(query: PerformanceReportQuery): {
    from: Date;
    to: Date;
    label: string;
    previousFrom: Date;
    previousTo: Date;
    previousLabel: string;
  } {
    const anchor = query.date ? new Date(`${query.date}T00:00:00+05:30`) : new Date();
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth();

    if (query.period === 'MONTH') {
      const from = new Date(Date.UTC(y, m, 1));
      const to = new Date(Date.UTC(y, m + 1, 1) - 1);
      const prevFrom = new Date(Date.UTC(y, m - 1, 1));
      const prevTo = new Date(Date.UTC(y, m, 1) - 1);
      const name = (d: Date) =>
        d.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
      return {
        from,
        to,
        label: name(from),
        previousFrom: prevFrom,
        previousTo: prevTo,
        previousLabel: name(prevFrom),
      };
    }

    if (query.period === 'QUARTER') {
      // Financial quarters, April to March — the year this business plans on.
      const fyQuarter = Math.floor(((m + 9) % 12) / 3);
      const startMonth = (fyQuarter * 3 + 3) % 12;
      const startYear = m >= 3 ? (startMonth < 3 ? y + 1 : y) : startMonth < 3 ? y : y - 1;
      const from = new Date(Date.UTC(startYear, startMonth, 1));
      const to = new Date(Date.UTC(startYear, startMonth + 3, 1) - 1);
      const prevFrom = new Date(Date.UTC(startYear, startMonth - 3, 1));
      const prevTo = new Date(Date.UTC(startYear, startMonth, 1) - 1);
      const label = (d: Date) => {
        const mm = d.getUTCMonth();
        const q = Math.floor(((mm + 9) % 12) / 3) + 1;
        return `Q${q} ${d.getUTCFullYear()}`;
      };
      return {
        from,
        to,
        label: label(from),
        previousFrom: prevFrom,
        previousTo: prevTo,
        previousLabel: label(prevFrom),
      };
    }

    /*
      As on date: everything up to the anchor day.

      Compared against the same number of days immediately before it, so
      "progress" is like-for-like rather than a cumulative total against a
      month. Ninety days is the span the scorecard already uses.
    */
    const to = anchor;
    const from = new Date(to.getTime() - 90 * 86_400_000);
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - 90 * 86_400_000);
    return {
      from,
      to,
      label: `As on ${istDayKey(to)}`,
      previousFrom,
      previousTo,
      previousLabel: 'Previous 90 days',
    };
  }

  /** The people this report covers, and what to call the selection. */
  private async population(
    user: AuthenticatedPrincipal,
    query: PerformanceReportQuery,
  ): Promise<{ where: Record<string, unknown>; label: string }> {
    const base: Record<string, unknown> = {
      deletedAt: null,
      userType: 'INTERNAL',
      status: 'ACTIVE',
    };

    /*
      Never wider than what the caller may already see. A manager asking for a
      branch they do not cover gets their own slice of it, not a refusal — the
      scope is the answer, not an error.

      Driven by `dataScope`, not by whether the person happens to have an org
      unit. The earlier version fell back to the org subtree whenever
      `orgUnitPath` was set, which it is for everybody — so a Sales Executive
      on SELF scope saw every colleague in their branch, by name and score,
      and the `{ id: user.id }` branch only ever fired for somebody filed
      nowhere at all.
    */
    const reach = ((): Record<string, unknown> => {
      switch (user.dataScope) {
        case 'ALL':
          return {};
        case 'SELF':
          return { id: user.id };
        case 'TEAM':
          // Their own reports, and themselves. `teamUserIds` is the reporting
          // line the principal already carries for every other scoped query.
          return { id: { in: [user.id, ...user.teamUserIds] } };
        default:
          // ZONE, REGION and BRANCH are all "my subtree", which is exactly
          // what the materialised path expresses.
          return user.orgUnitPath
            ? { orgUnit: { path: { startsWith: user.orgUnitPath } } }
            : { id: user.id };
      }
    })();

    if (query.scope === 'TEAM') {
      if (query.userId) {
        const person = await this.prisma.user.findUnique({
          where: { id: query.userId },
          select: { firstName: true, lastName: true },
        });
        return {
          where: { ...base, ...reach, id: query.userId },
          label: person ? `${person.firstName} ${person.lastName}`.trim() : 'Selected person',
        };
      }
      if (query.designationId) {
        const designation = await this.prisma.designation.findUnique({
          where: { id: query.designationId },
          select: { name: true },
        });
        return {
          where: { ...base, ...reach, designationId: query.designationId },
          label: designation?.name ?? 'Selected designation',
        };
      }
      return { where: { ...base, ...reach }, label: 'My team' };
    }

    /*
      A vertical is a reporting line, not a place.

      Everyone whose chain of managers reaches this National Head, found by
      walking the whole directory once in memory — a query per hop up each of
      several hundred chains is the alternative, and it is not one.
    */
    if (query.scope === 'VERTICAL') {
      if (!query.verticalHeadId) {
        return { where: { ...base, ...reach }, label: 'All verticals' };
      }
      const directory = await this.directory();
      const members = [...directory.lines.keys()].filter(
        (id) => verticalHeadOf(id, directory.lines) === query.verticalHeadId,
      );
      return {
        where: { ...base, ...reach, id: { in: members } },
        label: `${directory.names.get(query.verticalHeadId) ?? 'Vertical'}'s vertical`,
      };
    }

    if (query.orgUnitId) {
      const unit = await this.prisma.orgUnit.findUnique({
        where: { id: query.orgUnitId },
        select: { name: true, path: true },
      });
      if (unit) {
        return {
          // By path, not by direct membership: a region holds branches, not
          // people, so counting its direct members reports zero.
          where: { ...base, ...reach, orgUnit: { path: { startsWith: unit.path } } },
          label: unit.name,
        };
      }
    }

    return {
      where: { ...base, ...reach },
      label: query.scope === 'REGION' ? 'All regions' : 'All branches',
    };
  }

  /** Every reporting line at once, for resolving verticals in memory. */
  private async directory(): Promise<{
    lines: Map<
      string,
      { managerId: string | null; designationCode: string | null; employeeCode: string | null }
    >;
    names: Map<string, string>;
    emails: Map<string, string>;
  }> {
    const everyone = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        managerId: true,
        employeeCode: true,
        designation: { select: { code: true } },
      },
    });

    return {
      lines: new Map(
        everyone.map((row) => [
          row.id,
          {
            managerId: row.managerId,
            designationCode: row.designation?.code ?? null,
            employeeCode: row.employeeCode,
          },
        ]),
      ),
      names: new Map(everyone.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()])),
      emails: new Map(everyone.map((row) => [row.id, row.email])),
    };
  }

  /**
   * The heads who own a vertical, with how many people roll up to each.
   *
   * Only those with somebody under them: a National Head nobody reports to
   * owns no vertical, and offering them in the picker gives an empty report
   * and a puzzled reader.
   */
  async verticals(): Promise<
    Array<{ id: string; fullName: string; email: string; people: number }>
  > {
    const directory = await this.directory();
    const counts = new Map<string, number>();

    for (const id of directory.lines.keys()) {
      const head = verticalHeadOf(id, directory.lines);
      if (head) counts.set(head, (counts.get(head) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([id, people]) => ({
        id,
        fullName: directory.names.get(id) ?? 'Unknown',
        email: directory.emails.get(id) ?? '',
        people,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * One report per vertical head, for the daily round of emails.
   *
   * The same report the screen builds for a single vertical, run across every
   * head who owns one. Built here rather than by the browser firing N requests
   * so that every report in the batch shares one anchor date — a set of emails
   * where some say Tuesday and some say Wednesday, because the clock rolled
   * over mid-loop, is the kind of thing nobody notices until a head queries a
   * number.
   *
   * Sequential rather than parallel: each report is several wide queries over
   * the lead table, and ten at once is how a report screen takes the database
   * down at nine in the morning. A handful of verticals makes this quick
   * enough.
   *
   * Sends nothing. It returns what would be sent, because mailing a judgement
   * of people's work to those people is not something to discover you have
   * done — the preview is the moment to notice a vertical is wrong.
   */
  async reportPerVertical(
    user: AuthenticatedPrincipal,
    query: PerformanceReportQuery,
  ): Promise<
    Array<{
      head: { id: string; fullName: string; email: string };
      report: PerformanceReport;
    }>
  > {
    const heads = await this.verticals();

    // One anchor for the whole batch, so every email agrees on "as on".
    const date = query.date ?? istDayKey(new Date());

    const out: Array<{
      head: { id: string; fullName: string; email: string };
      report: PerformanceReport;
    }> = [];

    for (const head of heads) {
      const report = await this.report(user, {
        ...query,
        scope: 'VERTICAL',
        verticalHeadId: head.id,
        date,
      });
      out.push({
        head: { id: head.id, fullName: head.fullName, email: head.email },
        report,
      });
    }

    return out;
  }

  async report(
    user: AuthenticatedPrincipal,
    query: PerformanceReportQuery,
  ): Promise<PerformanceReport> {
    const period = this.window(query);
    const { where, label } = await this.population(user, query);

    const people = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeCode: true,
        managerId: true,
        orgUnit: { select: { name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }],
      take: 500,
    });

    const managerNames = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: people.map((p) => p.managerId).filter((id): id is string => !!id) } },
          select: { id: true, firstName: true, lastName: true },
        })
      ).map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]),
    );

    const ownerIds = people.map((p) => p.id);
    const visible = this.scope.leadScope(user);

    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        AND: [visible],
        ownerId: { in: ownerIds },
        createdAt: { gte: period.from, lte: period.to },
      },
      select: {
        id: true,
        ownerId: true,
        status: true,
        score: true,
        createdAt: true,
        lastActivityAt: true,
        nextFollowUpAt: true,
        lostReason: true,
      },
    });

    const slippingBefore = new Date(Date.now() - SLIPPING_DAYS * 86_400_000);
    const rowsByOwner = new Map<string, typeof leads>();
    for (const lead of leads) {
      if (!lead.ownerId) continue;
      const bucket = rowsByOwner.get(lead.ownerId) ?? [];
      bucket.push(lead);
      rowsByOwner.set(lead.ownerId, bucket);
    }

    const rows: PerformanceResourceRow[] = people.map((person) => {
      const mine = rowsByOwner.get(person.id) ?? [];
      const converted = mine.filter((l) => l.status === 'CONVERTED').length;
      const lost = mine.filter((l) => l.status === 'LOST' || l.status === 'DISQUALIFIED').length;
      const open = mine.length - converted - lost;

      /*
        "Unattended" is no interaction, not an overdue date.

        `lastActivityAt` is stamped by a human interaction and nothing else, so
        a null means nobody has spoken to this client since the lead was
        created — which is the question being asked, and is not the same as a
        follow-up date having slipped.
      */
      const unattendedEver = mine.filter((l) => !l.lastActivityAt).length;
      const unattendedTwoDays = mine.filter(
        (l) => !l.lastActivityAt || l.lastActivityAt < slippingBefore,
      ).length;

      const rated: RatedLead[] = mine.map((l) => ({
        scoreAtAssignment: l.score,
        converted: l.status === 'CONVERTED',
      }));

      /*
        Behaviour from what this report already has in hand.

        `medianFirstResponseHours` is left null — it needs the timestamp of the
        first interaction on every lead, which is a second pass over the
        activity table for a number this report does not show. `computeRating`
        accepts null and simply does not score that metric, which is the honest
        outcome: a missing input should not be scored as a bad one.
      */
      const openRows = mine.filter(
        (l) => l.status !== 'CONVERTED' && l.status !== 'LOST' && l.status !== 'DISQUALIFIED',
      );
      const lostRows = mine.filter((l) => l.status === 'LOST' || l.status === 'DISQUALIFIED');
      const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

      const rating =
        mine.length >= MIN_LEADS_TO_RATE
          ? computeRating({
              leads: rated,
              behaviour: {
                medianFirstResponseHours: null,
                followUpCoverage: share(
                  openRows.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt > new Date()).length,
                  openRows.length,
                ),
                overdueRate: share(
                  openRows.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt <= new Date()).length,
                  openRows.length,
                ),
                activitiesPerLead: share(
                  mine.filter((l) => l.lastActivityAt).length,
                  openRows.length,
                ),
                /*
                  Leads ever spoken to, over leads held.

                  Approximated here from `lastActivityAt` rather than from
                  the activity table: this report covers a whole vertical in
                  one pass, and a per-lead interaction query across several
                  hundred people is the thing that turns a report into a
                  table scan. A lead with any activity has been touched,
                  which is the question being asked.
                */
                contactCoverage: share(mine.filter((l) => l.lastActivityAt).length, mine.length),
                /*
                  Lost reasons per lead here, not per product.

                  The single-person scorecard counts lost *products*, which
                  is the truer measure. This report does not load products —
                  deliberately, for the same cost reason — so it uses the
                  lead roll-up and will read slightly higher. It carries five
                  per cent of the behaviour score, and loading every
                  product for every person in a vertical to sharpen it is a
                  poor trade.
                */
                lostReasonCoverage: share(
                  lostRows.filter((l) => l.lostReason).length,
                  lostRows.length,
                ),
              },
            })
          : null;

      return {
        userId: person.id,
        fullName: `${person.firstName} ${person.lastName}`.trim(),
        email: person.email,
        employeeCode: person.employeeCode,
        branch: person.orgUnit?.name ?? null,
        designation: person.designation?.name ?? null,
        reportingTo: person.managerId ? (managerNames.get(person.managerId) ?? null) : null,
        totalLeads: mine.length,
        openLeads: open,
        converted,
        lost,
        unattendedEver,
        unattendedTwoDays,
        conversionRate: rate(converted, mine.length),
        overallScore: rating ? rating.overall : null,
        scoreBand: rating ? rating.band : null,
        scoreExplanation: rating ? rating.explanation : [],
      };
    });

    const sum = (pick: (row: PerformanceResourceRow) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);

    const totals: PerformanceTotals = {
      totalLeads: sum((r) => r.totalLeads),
      openLeads: sum((r) => r.openLeads),
      converted: sum((r) => r.converted),
      lost: sum((r) => r.lost),
      unattendedEver: sum((r) => r.unattendedEver),
      unattendedTwoDays: sum((r) => r.unattendedTwoDays),
      conversionRate: rate(
        sum((r) => r.converted),
        sum((r) => r.totalLeads),
      ),
      resourcesWithoutLeads: rows.filter((r) => r.totalLeads === 0).length,
      resourceCount: rows.length,
    };

    const progress = await this.progress(user, ownerIds, period, totals);

    return {
      scope: query.scope,
      scopeLabel: label,
      period: {
        kind: query.period,
        label: period.label,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      totals,
      progress,
      rows,
      summary: this.explain(totals, progress),
      /*
        Who the report is addressed to, which is not the same as who it is
        about.

        A team report goes to the team — it is their own work. A vertical
        report goes to the head who owns it: it is about those reps, written
        for that person, and mailing it to all of them would publish a
        judgement of each to the others. A region or a branch is a place and
        has no obvious recipient, so nothing is suggested and the send button
        stays hidden.
      */
      suggestedRecipients:
        query.scope === 'TEAM'
          ? rows.map((row) => ({ fullName: row.fullName, email: row.email }))
          : query.scope === 'VERTICAL' && query.verticalHeadId
            ? await (async () => {
                const head = await this.prisma.user.findUnique({
                  where: { id: query.verticalHeadId },
                  select: { firstName: true, lastName: true, email: true },
                });
                return head
                  ? [{ fullName: `${head.firstName} ${head.lastName}`.trim(), email: head.email }]
                  : [];
              })()
            : [],
    };
  }

  /** The same totals for the window before, reduced to the deltas worth saying. */
  private async progress(
    user: AuthenticatedPrincipal,
    ownerIds: string[],
    period: { previousFrom: Date; previousTo: Date; previousLabel: string },
    now: PerformanceTotals,
  ): Promise<PerformanceProgress | null> {
    if (ownerIds.length === 0) return null;

    const previous = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        AND: [this.scope.leadScope(user)],
        ownerId: { in: ownerIds },
        createdAt: { gte: period.previousFrom, lte: period.previousTo },
      },
      select: { status: true },
    });

    const converted = previous.filter((l) => l.status === 'CONVERTED').length;
    const previousRate = rate(converted, previous.length);

    return {
      previousLabel: period.previousLabel,
      totalLeads: previous.length,
      converted,
      conversionRate: previousRate,
      conversionRateDelta:
        now.conversionRate !== null && previousRate !== null
          ? Number((now.conversionRate - previousRate).toFixed(1))
          : null,
      totalLeadsDeltaPercent:
        previous.length > 0
          ? Number((((now.totalLeads - previous.length) / previous.length) * 100).toFixed(1))
          : null,
    };
  }

  /**
   * The group's position in sentences.
   *
   * A score with no explanation gets argued with rather than acted on, and the
   * three things worth saying are almost always the same: are we converting,
   * are we moving, and what is being left alone.
   */
  private explain(totals: PerformanceTotals, progress: PerformanceProgress | null): string[] {
    const lines: string[] = [];

    lines.push(
      totals.totalLeads === 0
        ? 'No leads were created in this period.'
        : `${totals.totalLeads} leads, ${totals.converted} converted — a ${totals.conversionRate ?? 0}% conversion rate across ${totals.resourceCount} people.`,
    );

    if (progress && progress.conversionRateDelta !== null) {
      const d = progress.conversionRateDelta;
      lines.push(
        d === 0
          ? `Conversion is level with ${progress.previousLabel}.`
          : `Conversion is ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points on ${progress.previousLabel} (${progress.conversionRate}%).`,
      );
    }

    if (totals.unattendedEver > 0) {
      lines.push(
        `${totals.unattendedEver} leads have never been spoken to, and ${totals.unattendedTwoDays} have had no contact in ${SLIPPING_DAYS} days.`,
      );
    }

    if (totals.resourcesWithoutLeads > 0) {
      lines.push(
        `${totals.resourcesWithoutLeads} of ${totals.resourceCount} people hold no leads at all.`,
      );
    }

    return lines;
  }
}
