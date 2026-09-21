import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  captureUrl,
  canTransitionEvent,
  repCaptureUrl,
  EVENT_STATUS_TRANSITIONS,
  type ChangeEventStatusInput,
  type CreateEventInput,
  type EventDetail,
  type EventListItem,
  type EventQuery,
  type EventRepBreakdown,
  type EventStatus,
  type UpdateEventInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

const PUBLIC_WEB_URL = (): string => process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';

/** Statuses that mean nobody has worked the lead yet. */
const UNCONTACTED = ['NEW'] as const;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Whether this viewer sees the event book whole.
   *
   * `campaign:read` is what marketing and management hold; `event:view` on its
   * own is what a rep is given by the branch switch. The first sees every event
   * and every lead on it, the second sees the events their office is running
   * and only the leads their own QR brought in.
   */
  private seesEverything(user: AuthenticatedPrincipal): boolean {
    return user.permissions.includes('campaign:read');
  }

  /** The events a rep may see: their branch's and their ancestors', still open. */
  private repEventFilter(user: AuthenticatedPrincipal): Record<string, unknown> {
    // The principal already carries the materialised path, so the chain of
    // ancestors is in hand without touching the database.
    const orgUnitIds = (user.orgUnitPath ?? '').split('/').filter(Boolean);
    return {
      // An event with no org unit belongs to the whole company, so everybody
      // with access sees it. Matching only the chain would have hidden exactly
      // the national events a branch is most likely to be working.
      OR: [{ orgUnitId: { in: orgUnitIds } }, { orgUnitId: null }],
      // Closed and cancelled events are of no use to somebody holding a phone
      // at a desk, and showing them invites a QR being printed from one.
      status: { in: ['PLANNED', 'RUNNING'] },
    };
  }

  async list(
    user: AuthenticatedPrincipal,
    query: EventQuery,
  ): Promise<PaginatedResult<EventListItem>> {
    const and: Record<string, unknown>[] = [];

    if (!this.seesEverything(user)) and.push(this.repEventFilter(user));

    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { code: { contains: query.q, mode: 'insensitive' } },
          { venue: { contains: query.q, mode: 'insensitive' } },
          { reference: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    if (query.city) and.push({ city: { equals: query.city, mode: 'insensitive' } });

    const where = { deletedAt: null, AND: and };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        // Soonest first among upcoming, which is what a branch planning next
        // weekend actually wants at the top.
        orderBy: [{ startsAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          campaign: { select: { id: true, name: true } },
          _count: { select: { leads: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    const converted = await this.prisma.lead.groupBy({
      by: ['eventId'],
      where: {
        eventId: { in: rows.map((row) => row.id) },
        deletedAt: null,
        status: 'CONVERTED',
      },
      _count: { _all: true },
      orderBy: { eventId: 'asc' },
    });
    const convertedByEvent = new Map(converted.map((row) => [row.eventId, row._count._all]));

    return paginate(
      rows.map((row) => this.toListItem(row, convertedByEvent.get(row.id) ?? 0)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(user: AuthenticatedPrincipal, id: string): Promise<EventDetail> {
    /*
      A rep may only open an event their own office is running.

      Filtered in the query rather than checked afterwards, so an event outside
      their reach answers "not found" rather than "forbidden" — the same answer
      an id that does not exist gets, which is what stops the endpoint being
      used to discover which events other branches are running.
    */
    const reach = this.seesEverything(user) ? {} : this.repEventFilter(user);

    const event = await this.prisma.event.findFirst({
      where: { id, deletedAt: null, ...reach },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { leads: { where: { deletedAt: null } } } },
      },
    });
    if (!event) throw new NotFoundException({ title: 'Event not found' });

    /*
      A rep sees their own numbers, not the stall's.

      Keyed on `capturedById` rather than `ownerId` so that a lead later handed
      to a colleague still counts for the person whose QR actually brought it
      in. Credit for the scan does not move with the work.
    */
    const mine = this.seesEverything(user) ? {} : { capturedById: user.id };

    /*
      The viewer's own employee code, for their personal QR.

      Read here rather than carried on the token: putting it in the JWT would
      mean everyone already signed in has no code until they sign in again, and
      this is one indexed lookup on a page that already runs several.
    */
    const employeeCode = user.isService
      ? null
      : ((
          await this.prisma.user.findUnique({
            where: { id: user.id },
            select: { employeeCode: true },
          })
        )?.employeeCode ?? null);

    const byStatus = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { eventId: id, deletedAt: null, ...mine },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });

    /*
      How many of this event's leads came through somebody's personal QR.

      The plain banner QR carries no employee code, so its leads land with
      `capturedById` null. The split is the only way to tell whether handing
      reps their own codes actually changed anything.
    */
    const [assignedLeads, unassignedLeads] = this.seesEverything(user)
      ? await Promise.all([
          this.prisma.lead.count({
            where: { eventId: id, deletedAt: null, capturedById: { not: null } },
          }),
          this.prisma.lead.count({
            where: { eventId: id, deletedAt: null, capturedById: null },
          }),
        ])
      : /*
          For a rep the split is not a question: everything they can see here
          came through their own QR, so it is all assigned and none of it is
          unattributed. Spreading the viewer filter over a `capturedById: null`
          clause produced the opposite — the later key won, and the rep's own
          leads were counted a second time as unattributed.
        */
        [byStatus.reduce((sum, row) => sum + row._count._all, 0), 0];

    /*
      Everyone who registered at the stall, and how many of them we already
      knew. Counted separately from `leads` on purpose: a client of ten years
      who walks past is somebody we met, not a lead this event generated, and
      folding them together would flatter the event's conversion rate with
      business it never won.
    */
    const [attended, returning] = await Promise.all([
      /*
        A union, not a count of the attendance table.

        Attendance only started being recorded when the table was added, so
        every lead captured at an event before that has no row — counting rows
        alone would report a well-attended past event as having met nobody, and
        would show "people met" as smaller than "leads captured", which reads as
        a bug to anyone looking at it.

        Being captured here *is* attendance; the table records the people that
        does not cover.
      */
      this.prisma.lead.count({
        where: {
          deletedAt: null,
          ...mine,
          OR: [{ eventId: id }, { eventAttendances: { some: { eventId: id } } }],
        },
      }),
      // Not scoped by rep: a returning client is a fact about the event, and
      // attendance carries no capturing rep to filter on.
      this.seesEverything(user)
        ? this.prisma.eventAttendance.count({ where: { eventId: id, returning: true } })
        : Promise.resolve(0),
    ]);

    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const converted = byStatus
      .filter((row) => row.status === 'CONVERTED')
      .reduce((sum, row) => sum + row._count._all, 0);
    const uncontacted = byStatus
      .filter((row) => (UNCONTACTED as readonly string[]).includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

    return {
      ...this.toListItem(event, converted),
      leads: total,
      captureUrl: captureUrl(PUBLIC_WEB_URL(), 'EVENT', event.code),
      allowedTransitions: [...EVENT_STATUS_TRANSITIONS[event.status as EventStatus]],
      pipeline: byStatus
        .map((row) => ({ status: row.status, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      assignedLeads,
      unassignedLeads,
      scopedToViewer: !this.seesEverything(user),
      /*
        The rep's own QR, carrying their employee code.

        Only offered to somebody who has one. A viewer with no employee code —
        an admin account, say — gets null and the plain event QR above, because
        a link tagged with an empty code is worse than no link at all.
      */
      myCaptureUrl: employeeCode
        ? repCaptureUrl(PUBLIC_WEB_URL(), event.code, employeeCode)
        : null,
      myEmployeeCode: employeeCode,
      uncontacted,
      attended,
      returningAttendees: returning,
      conversionRate: total > 0 ? Math.round((converted / total) * 1000) / 10 : 0,
    };
  }

  /**
   * This event's leads grouped by the rep whose QR captured them.
   *
   * Two queries rather than a join: one grouping to get the counts, one to put
   * names to the ids. Grouping in the database and naming in a second pass
   * keeps the count honest when a rep has since been deactivated — their row
   * still appears, because the leads they brought in still exist.
   *
   * Leads from the plain banner QR are not dropped. They are collected into a
   * single "Unassigned Leads" row, because "how many did nobody get credit for"
   * is exactly the number this breakdown exists to expose.
   */
  async byRep(user: AuthenticatedPrincipal, id: string): Promise<EventRepBreakdown[]> {
    const reach = this.seesEverything(user) ? {} : this.repEventFilter(user);
    const event = await this.prisma.event.findFirst({
      where: { id, deletedAt: null, ...reach },
      select: { id: true },
    });
    if (!event) throw new NotFoundException({ title: 'Event not found' });

    // A rep gets their own row and nothing else. Showing them a league table of
    // colleagues is a different product decision from the one asked for.
    const mine = this.seesEverything(user) ? {} : { capturedById: user.id };

    const grouped = await this.prisma.lead.groupBy({
      by: ['capturedById', 'status'],
      where: { eventId: id, deletedAt: null, ...mine },
      _count: { _all: true },
      orderBy: [{ capturedById: 'asc' }, { status: 'asc' }],
    });

    const userIds = [
      ...new Set(grouped.map((row) => row.capturedById).filter((v): v is string => Boolean(v))),
    ];
    const people = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));

    const rows = new Map<string, EventRepBreakdown>();
    for (const row of grouped) {
      const key = row.capturedById ?? '';
      let entry = rows.get(key);
      if (!entry) {
        const person = row.capturedById ? byId.get(row.capturedById) : null;
        entry = {
          userId: row.capturedById,
          fullName: person
            ? `${person.firstName} ${person.lastName}`.trim()
            : row.capturedById
              ? 'Removed user'
              : 'Unassigned Leads',
          employeeCode: person?.employeeCode ?? null,
          total: 0,
          byStatus: [],
        };
        rows.set(key, entry);
      }
      entry.total += row._count._all;
      entry.byStatus.push({ status: row.status, count: row._count._all });
    }

    // Busiest first; the unattributed row last whatever its size, because it is
    // a footnote to the table rather than a competitor in it.
    return [...rows.values()].sort((a, b) => {
      if (!a.userId) return 1;
      if (!b.userId) return -1;
      return b.total - a.total;
    });
  }

  async create(user: AuthenticatedPrincipal, input: CreateEventInput) {
    await this.assertCodeIsFree(input.code);

    const reference = await this.references.next('EV');

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          reference,
          name: input.name,
          code: input.code,
          venue: input.venue ?? null,
          city: input.city ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          expectedFootfall: input.expectedFootfall ?? null,
          ownerId: input.ownerId ?? user.id,
          orgUnitId: input.orgUnitId ?? user.orgUnitId ?? null,
          campaignId: input.campaignId ?? null,
          createdById: user.id,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'event',
        aggregateId: created.id,
        eventType: 'event.created',
        payload: { reference, code: created.code, name: created.name },
      });

      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'event',
      resourceId: event.id,
      changes: { name: event.name, code: event.code, startsAt: event.startsAt.toISOString() },
    });

    return this.findOne(user, event.id);
  }

  async update(user: AuthenticatedPrincipal, id: string, input: UpdateEventInput) {
    const before = await this.prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ title: 'Event not found' });

    const startsAt = input.startsAt ?? before.startsAt;
    const endsAt = input.endsAt === undefined ? before.endsAt : input.endsAt;
    if (endsAt && endsAt < startsAt) {
      // Re-checked here because either date can arrive alone; the schema only
      // sees the half that was sent.
      throw new BadRequestException({
        title: 'Invalid times',
        detail: 'The end time cannot be before the start time.',
      });
    }

    const after = await this.prisma.event.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.venue !== undefined ? { venue: input.venue } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.expectedFootfall !== undefined
          ? { expectedFootfall: input.expectedFootfall }
          : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'event',
      resourceId: id,
      changes: diffRecords(before as never, after as never),
    });

    return this.findOne(user, id);
  }

  async changeStatus(user: AuthenticatedPrincipal, id: string, input: ChangeEventStatusInput) {
    const event = await this.prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!event) throw new NotFoundException({ title: 'Event not found' });

    const from = event.status as EventStatus;
    if (from === input.status) return this.findOne(user, id);

    if (!canTransitionEvent(from, input.status)) {
      throw new BadRequestException({
        title: 'Status change not allowed',
        detail:
          EVENT_STATUS_TRANSITIONS[from].length === 0
            ? `A ${from.toLowerCase()} event is final and cannot change status.`
            : `A ${from.toLowerCase()} event can only move to: ${EVENT_STATUS_TRANSITIONS[from].join(', ')}.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { status: input.status } });
      await this.outbox.publish(tx, {
        aggregateType: 'event',
        aggregateId: id,
        eventType: `event.${input.status.toLowerCase()}`,
        payload: { reference: event.reference, code: event.code, from, to: input.status },
      });
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'event',
      resourceId: id,
      changes: { status: { from, to: input.status } },
    });

    return this.findOne(user, id);
  }

  // -------------------------------------------------------------------------

  /**
   * An event code must not collide with a partner referral code.
   *
   * They live in separate URL segments so a collision cannot misroute a
   * capture, but a shared-looking code is still confusing to a human reading a
   * banner and a payout report side by side. Cheap to prevent, so prevented.
   */
  private async assertCodeIsFree(code: string): Promise<void> {
    const [event, partner] = await Promise.all([
      this.prisma.event.findUnique({ where: { code }, select: { name: true } }),
      this.prisma.partner.findFirst({
        where: { referralCode: { equals: code, mode: 'insensitive' } },
        select: { name: true },
      }),
    ]);

    if (event) {
      throw new ConflictException({
        title: 'That event code is taken',
        detail: `"${code}" is already used by ${event.name}. Codes must be unique because they are printed on the QR.`,
      });
    }
    if (partner) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${code}" is already a referral code for ${partner.name}.`,
      });
    }
  }

  private toListItem(
    row: {
      id: string;
      reference: string;
      name: string;
      code: string;
      status: string;
      venue: string | null;
      city: string | null;
      startsAt: Date;
      endsAt: Date | null;
      expectedFootfall: number | null;
      createdAt: Date;
      owner: { id: string; firstName: string; lastName: string } | null;
      campaign: { id: string; name: string } | null;
      _count: { leads: number };
    },
    converted: number,
  ): EventListItem {
    return {
      id: row.id,
      reference: row.reference,
      name: row.name,
      code: row.code,
      status: row.status as EventStatus,
      venue: row.venue,
      city: row.city,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
      expectedFootfall: row.expectedFootfall,
      owner: row.owner
        ? { id: row.owner.id, fullName: `${row.owner.firstName} ${row.owner.lastName}`.trim() }
        : null,
      campaign: row.campaign,
      leads: row._count.leads,
      converted,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
