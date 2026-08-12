import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  captureUrl,
  canTransitionEvent,
  EVENT_STATUS_TRANSITIONS,
  type ChangeEventStatusInput,
  type CreateEventInput,
  type EventDetail,
  type EventListItem,
  type EventQuery,
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

  async list(query: EventQuery): Promise<PaginatedResult<EventListItem>> {
    const and: Record<string, unknown>[] = [];

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

  async findOne(id: string): Promise<EventDetail> {
    const event = await this.prisma.event.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true } },
        campaign: { select: { id: true, name: true } },
        _count: { select: { leads: { where: { deletedAt: null } } } },
      },
    });
    if (!event) throw new NotFoundException({ title: 'Event not found' });

    const byStatus = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { eventId: id, deletedAt: null },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    });

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
      uncontacted,
      conversionRate: total > 0 ? Math.round((converted / total) * 1000) / 10 : 0,
    };
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

    return this.findOne(event.id);
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

    return this.findOne(id);
  }

  async changeStatus(user: AuthenticatedPrincipal, id: string, input: ChangeEventStatusInput) {
    const event = await this.prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!event) throw new NotFoundException({ title: 'Event not found' });

    const from = event.status as EventStatus;
    if (from === input.status) return this.findOne(id);

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

    return this.findOne(id);
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
